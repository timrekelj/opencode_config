import { modelKey, type ModelKey, type Price, type PricesResult } from "./types"

export const MODELS_DEV_URL = "https://models.dev/api.json"
const TTL_MS = 6 * 60 * 60 * 1000
const FAILURE_RETRY_MS = 60 * 1000

interface RawCost {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
}

type Catalog = Record<string, { models?: Record<string, { cost?: RawCost }> }>

/** Providers searched, in order, when a model's own provider is missing from models.dev. */
const PREFERRED = ["anthropic", "openai", "google", "xai", "mistral", "deepseek"]

/** Bare family names could be any generation, so they stay unpriced instead of guessing. */
const UNPRICEABLE = new Set(["synthetic", "<synthetic>", "opus", "sonnet", "haiku", "fable"])

const normalize = (id: string) =>
  id
    .trim()
    .toLowerCase()
    .replace(/^.*\//, "")
    // Context-window variants such as `[1m]` are priced at the base model.
    .replace(/\[.*$/, "")
    .replace(/[:@].*$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-latest$/, "")

const toPrice = (cost: RawCost | undefined, source: string): Price | null => {
  if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") return null
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache_read ?? cost.input,
    cacheWrite: cost.cache_write ?? cost.input,
    source,
  }
}

const paid = (price: Price | null) => !!price && (price.input > 0 || price.output > 0)

export function lookup(catalog: Catalog, model: ModelKey): Price | null {
  const own = catalog[model.providerID]?.models
  const exact = toPrice(own?.[model.id]?.cost, modelKey(model))
  if (exact) return exact

  const wanted = normalize(model.id)
  if (!wanted || UNPRICEABLE.has(wanted)) return null
  const providers = [model.providerID, ...PREFERRED, ...Object.keys(catalog)]
  const seen = new Set<string>()
  for (const providerID of providers) {
    if (seen.has(providerID)) continue
    seen.add(providerID)
    const models = catalog[providerID]?.models
    if (!models) continue
    for (const [id, entry] of Object.entries(models)) {
      if (id !== model.id && normalize(id) !== wanted) continue
      const price = toPrice(entry.cost, `${providerID}/${id}`)
      if (paid(price)) return price
    }
  }
  return null
}

export class Pricing {
  private catalog: Catalog | undefined
  private fetchedAt = 0
  private failedAt = 0
  private pending: Promise<Catalog> | undefined

  constructor(
    private readonly url = MODELS_DEV_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async load(force: boolean): Promise<Catalog> {
    const fresh = this.catalog && Date.now() - this.fetchedAt < TTL_MS
    if (fresh && !force) return this.catalog!
    // Keep serving a stale catalog for a minute after a failed refresh instead of hammering models.dev.
    if (this.catalog && !force && Date.now() - this.failedAt < FAILURE_RETRY_MS) return this.catalog
    this.pending ??= (async () => {
      try {
        const response = await this.fetcher(this.url, { headers: { accept: "application/json" } })
        if (!response.ok) throw new Error(`models.dev responded ${response.status} ${response.statusText}`)
        const catalog = (await response.json()) as Catalog
        if (!catalog || typeof catalog !== "object") throw new Error("models.dev returned an unexpected payload")
        this.catalog = catalog
        this.fetchedAt = Date.now()
        return catalog
      } catch (error) {
        this.failedAt = Date.now()
        if (this.catalog) return this.catalog
        throw new Error(`Could not load prices from models.dev: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        this.pending = undefined
      }
    })()
    return this.pending
  }

  async prices(models: ModelKey[], refresh = false): Promise<PricesResult> {
    const catalog = await this.load(refresh)
    const prices: Record<string, Price | null> = {}
    for (const model of models) {
      if (!model || typeof model.providerID !== "string" || typeof model.id !== "string") continue
      prices[modelKey(model)] = lookup(catalog, model)
    }
    return { fetchedAt: this.fetchedAt, prices }
  }
}
