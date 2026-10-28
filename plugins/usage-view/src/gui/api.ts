import type { Context } from "@opencode/plugin/gui"
import { UsageView } from "../rpc"
import { modelKey, type ModelKey, type Price, type PricesResult, type RetainedRange, type RetainedResult } from "../types"
import { totalTokens, type Tokens } from "./format"

type Client = Context["client"]
export type Stats = Awaited<ReturnType<Client["session"]["stats"]>>
export type SessionInfo = Awaited<ReturnType<Client["session"]["list"]>>["data"][number]

export type RangeId = "today" | "7d" | "30d" | "all"
export type Scope = "project" | "all"

export const RANGES: { value: RangeId; label: string; short: string }[] = [
  { value: "today", label: "Today", short: "Today" },
  { value: "7d", label: "7 days", short: "7d" },
  { value: "30d", label: "30 days", short: "30d" },
  { value: "all", label: "All time", short: "All" },
]

export interface Bucket {
  from: number
  to: number
  /** Full label for tooltips. */
  label: string
  /** Axis label. */
  short: string
  /** Undefined for buckets in the future. */
  stats?: Stats
}

export interface UsageData {
  range: RangeId
  from: number | undefined
  to: number
  totals: Stats
  buckets: Bucket[]
  sessions: SessionInfo[]
  /** True when the session scan stopped before reaching the start of the range. */
  sessionsTruncated: boolean
  prices: Record<string, Price | null>
  pricesError?: string
  /** Usage of deleted sessions included in the totals, if any. */
  retained?: RetainedRange
  retainedError?: string
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const SESSION_PAGE = 200
const SESSION_PAGES = 10

const timezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

const startOfDay = (time: number) => {
  const d = new Date(time)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const addDays = (time: number, days: number) => {
  const d = new Date(time)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours()).getTime()
}

const fmtDay = (time: number, opts: Intl.DateTimeFormatOptions) => new Date(time).toLocaleDateString(undefined, opts)
const fmtHour = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: "numeric" })

export function rangeStart(range: RangeId, now = Date.now()): number | undefined {
  const today = startOfDay(now)
  if (range === "today") return today
  if (range === "7d") return addDays(today, -6)
  if (range === "30d") return addDays(today, -29)
  return undefined
}

export function makeBuckets(range: RangeId, now: number, earliest: number): Omit<Bucket, "stats">[] {
  const today = startOfDay(now)
  if (range === "today") {
    const d = new Date(today)
    return Array.from({ length: 24 }, (_, h) => {
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime()
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h + 1).getTime()
      return { from, to, label: `${fmtHour(from)} – ${fmtHour(to)}`, short: String(h) }
    })
  }
  const daily = (start: number, count: number, short: Intl.DateTimeFormatOptions) =>
    Array.from({ length: count }, (_, i) => {
      const from = addDays(start, i)
      return {
        from,
        to: addDays(start, i + 1),
        label: fmtDay(from, { weekday: "short", month: "short", day: "numeric" }),
        short: fmtDay(from, short),
      }
    })
  if (range === "7d") return daily(addDays(today, -6), 7, { weekday: "short" })
  if (range === "30d") return daily(addDays(today, -29), 30, { day: "numeric" })

  const start = startOfDay(Math.min(earliest, now))
  const days = Math.max(1, Math.round((today - start) / DAY) + 1)
  if (days <= 31) return daily(start, days, { month: "short", day: "numeric" })
  // Roughly 12 buckets of whole weeks, ending today.
  const size = 7 * Math.ceil(days / 7 / 12)
  const count = Math.ceil(days / size)
  const first = addDays(today, 1 - count * size)
  return Array.from({ length: count }, (_, i) => {
    const from = addDays(first, i * size)
    const to = addDays(first, (i + 1) * size)
    const last = addDays(to, -1)
    return {
      from,
      to,
      label: `${fmtDay(from, { month: "short", day: "numeric", year: "numeric" })} – ${fmtDay(last, { month: "short", day: "numeric", year: "numeric" })}`,
      short: fmtDay(from, { month: "short", day: "numeric" }),
    }
  })
}

export function errorMessage(error: unknown): string {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  const value = error as { message?: unknown; data?: { message?: unknown } }
  if (typeof value.data?.message === "string") return value.data.message
  if (typeof value.message === "string") return value.message
  return String(error)
}

async function listSessions(client: Client, project: string | undefined, from: number | undefined, signal: AbortSignal) {
  const all: SessionInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < SESSION_PAGES; page++) {
    const response = await client.session.list({ limit: SESSION_PAGE, order: "desc", project, cursor }, { signal })
    all.push(...response.data)
    const last = response.data.at(-1)
    const done =
      response.data.length < SESSION_PAGE || !response.cursor.next || (from !== undefined && last && last.time.updated < from)
    if (done) return { sessions: all, truncated: false }
    cursor = response.cursor.next ?? undefined
  }
  return { sessions: all, truncated: true }
}

type UsageRpc = {
  prices(input: object, options: object): Promise<PricesResult>
  retained(input: object, options: object): Promise<RetainedResult>
}

/** Adds the usage of deleted sessions to OpenCode's stats for the same range. */
export function addRetained(stats: Stats, extra: RetainedRange | undefined): Stats {
  if (!extra || extra.steps === 0) return stats
  const add = <T extends Tokens>(a: T, b: Tokens): T => ({
    ...a,
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cache: { ...a.cache, read: a.cache.read + b.cache.read, write: a.cache.write + b.cache.write },
  })
  const models = [...stats.models]
  for (const r of extra.models) {
    const index = models.findIndex((m) => modelKey(m.model) === modelKey(r.model))
    if (index === -1) {
      models.push({ model: r.model, steps: r.steps, cost: r.cost, tokens: r.tokens } as Stats["models"][number])
      continue
    }
    const m = models[index]!
    models[index] = { ...m, steps: m.steps + r.steps, cost: m.cost + r.cost, tokens: add(m.tokens, r.tokens) }
  }
  return {
    ...stats,
    sessions: stats.sessions + extra.sessions,
    subagents: stats.subagents + extra.subagents,
    steps: stats.steps + extra.steps,
    cost: stats.cost + extra.cost,
    tokens: add(stats.tokens, extra.tokens),
    models,
  }
}

export async function loadUsage(
  ctx: Pick<Context, "client">,
  input: { range: RangeId; project?: string; directory?: string },
  signal: AbortSignal,
): Promise<UsageData> {
  // Read ctx.client on every load: it changes after the server restarts.
  const client = ctx.client
  const now = Date.now()
  const from = rangeStart(input.range, now)
  const tz = timezone()
  const base = { project: input.project, timezone: tz }

  const [liveTotals, list] = await Promise.all([
    client.session.stats({ ...base, from, to: now, tools: "detail" }, { signal }),
    listSessions(client, input.project, from, signal),
  ])

  const directory = input.directory ?? list.sessions[0]?.location.directory
  const rpc = client.rpc(UsageView) as unknown as UsageRpc
  const rpcOptions = directory ? { location: { directory }, signal } : { signal }

  // Deleted sessions are optional extra data: a failure here must not break the view.
  let retainedError: string | undefined
  const retained = async (ranges: { from?: number; to: number }[]) => {
    try {
      return await rpc.retained({ ranges, project: input.project }, rpcOptions)
    } catch (error) {
      if (signal.aborted) throw error
      retainedError = errorMessage(error)
      return undefined
    }
  }

  const retainedTotal = await retained([{ from, to: now }])
  const earliest = Math.min(liveTotals.range.from || now, retainedTotal?.earliest ?? now)
  const totals = addRetained(liveTotals, retainedTotal?.ranges[0])

  const shells = makeBuckets(input.range, now, earliest)
  const [bucketStats, retainedBuckets] = await Promise.all([
    Promise.all(
      shells.map((bucket) =>
        bucket.from > now
          ? undefined
          : client.session.stats({ ...base, from: bucket.from, to: Math.min(bucket.to, now), tools: "none" }, { signal }),
      ),
    ),
    retainedTotal?.earliest === undefined
      ? undefined
      : retained(shells.map((bucket) => ({ from: bucket.from, to: Math.min(bucket.to, now) }))),
  ])
  const buckets: Bucket[] = shells.map((bucket, index) => {
    const stats = bucketStats[index]
    return stats ? { ...bucket, stats: addRetained(stats, retainedBuckets?.ranges[index]) } : bucket
  })

  const sessions = list.sessions
    .filter((s) => from === undefined || s.time.updated >= from)
    .sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens))

  const models = new Map<string, ModelKey>()
  const addModel = (m: { providerID: string; id: string } | undefined) => {
    if (m) models.set(modelKey(m), { providerID: m.providerID, id: m.id })
  }
  totals.models.forEach((m) => addModel(m.model))
  buckets.forEach((b) => b.stats?.models.forEach((m) => addModel(m.model)))
  sessions.slice(0, 50).forEach((s) => addModel(s.model))

  let prices: Record<string, Price | null> = {}
  let pricesError: string | undefined
  if (models.size > 0) {
    try {
      const result = await rpc.prices({ models: [...models.values()] }, rpcOptions)
      prices = result.prices
    } catch (error) {
      if (signal.aborted) throw error
      pricesError = errorMessage(error)
    }
  }

  const retainedRange = retainedTotal?.ranges[0]
  return {
    range: input.range,
    from,
    to: now,
    totals,
    buckets,
    sessions,
    sessionsTruncated: list.truncated,
    prices,
    pricesError,
    retained: retainedRange && retainedRange.steps > 0 ? retainedRange : undefined,
    retainedError,
  }
}
