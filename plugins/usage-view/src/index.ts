import { Plugin } from "@opencode/plugin"
import { DEFAULT_RETENTION_DAYS, defaultDatabasePath, Ledger } from "./ledger"
import { Limits } from "./limits"
import { parseAliases, Pricing } from "./pricing"
import { UsageView } from "./rpc"
import type { ModelKey } from "./types"

// The server loads the plugin once per location; they all share one ledger. The key is versioned and each entry is
// checked against this module's Ledger class, so a reload with new code never keeps an instance of the old one.
const SHARED = Symbol.for("usage-view.ledger.v2")
type Shared = { ledger: Ledger; refs: number; stop: () => void }
const registry = globalThis as typeof globalThis & { [SHARED]?: Map<string, Shared> }

export default Plugin.define({
  id: "usage-view",
  async setup(ctx) {
    const pricing = new Pricing(
      typeof ctx.options.url === "string" ? ctx.options.url : undefined,
      fetch,
      parseAliases(ctx.options.aliases),
    )
    const limits = new Limits()

    const path = typeof ctx.options.database === "string" ? ctx.options.database : defaultDatabasePath(ctx.app.channel)
    const ledgers = (registry[SHARED] ??= new Map())
    let shared = ledgers.get(path)
    // An entry from before a code reload belongs to the old module; its instances stop it on their own cleanup.
    if (shared && !(shared.ledger instanceof Ledger)) shared = undefined
    if (!shared) {
      const days = Number(ctx.options.retentionDays)
      const ledger = new Ledger(
        ctx.storage,
        path,
        (message) => console.warn(`usage-view: ${message}`),
        Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS,
      )
      const stop = ledger.start((signal) =>
        ctx.event.subscribe({ types: ["session.step.ended", "session.compaction.ended", "session.deleted"], signal }),
      )
      shared = { ledger, refs: 0, stop }
      ledgers.set(path, shared)
    }
    shared.refs++
    const ledger = shared.ledger

    const handle =
      <I>(fn: (input: I, signal: AbortSignal) => Promise<unknown>) =>
      async (input: unknown, context: { signal: AbortSignal; error: (...args: any[]) => any }) => {
        try {
          // RPC outputs must be plain JSON: drop `undefined` fields.
          return JSON.parse(JSON.stringify((await fn(input as I, context.signal)) ?? null))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return context.error("failed", message, { message })
        }
      }

    await ctx.rpc.register(UsageView, {
      prices: handle<{ models?: ModelKey[]; refresh?: boolean }>((i) =>
        pricing.prices(Array.isArray(i?.models) ? i.models : [], i?.refresh === true),
      ),
      retained: handle<{ ranges?: { from?: number; to: number }[]; project?: string }>((i) =>
        ledger.retained({
          ranges: Array.isArray(i?.ranges) ? i.ranges : [],
          project: typeof i?.project === "string" ? i.project : undefined,
        }),
      ),
      daily: handle<{ from?: number; to?: number; project?: string; timezone?: string }>((i) =>
        ledger.daily({
          from: typeof i?.from === "number" ? i.from : 0,
          to: typeof i?.to === "number" ? i.to : Date.now(),
          project: typeof i?.project === "string" ? i.project : undefined,
          timezone: typeof i?.timezone === "string" ? i.timezone : undefined,
        }),
      ),
      limits: handle<{ refresh?: boolean }>((i, signal) => limits.limits(i?.refresh === true, signal)),
    })

    const mine = shared
    return () => {
      if (--mine.refs > 0) return
      mine.stop()
      if (ledgers.get(path) === mine) ledgers.delete(path)
    }
  },
})
