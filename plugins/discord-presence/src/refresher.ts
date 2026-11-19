// Keeps the "Spent today" text fresh from the usage-view plugin. Never throws; failures are logged once per streak.
import { formatSpend, modelsIn, spend, UsageView } from "./spend"

export const REFRESH_INTERVAL_MS = 60_000

type Rpc = { daily(input: object): Promise<any>; prices(input: object): Promise<any> }

export type RefresherOptions = {
  /** The usage-view client; called on every refresh since the owning context can change. Undefined when none. */
  rpc: () => ((definition: typeof UsageView) => unknown) | undefined
  /** Called with the new text, only when it changed. */
  onText: (text: string | undefined) => void
  log: (message: string) => void
  now?: () => number
  timezone?: string
}

const midnight = (time: number) => {
  const d = new Date(time)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function createSpendRefresher(options: RefresherOptions) {
  const now = options.now ?? Date.now
  let text: string | undefined
  let pending: Promise<void> | undefined
  let failing = false
  let timer: ReturnType<typeof setInterval> | undefined

  const load = async () => {
    const call = options.rpc()
    if (!call) throw new Error("no plugin context")
    const rpc = call(UsageView) as Rpc
    const to = now()
    const rows = await rpc.daily({ from: midnight(to), to, timezone: options.timezone })
    let prices: Record<string, any> = {}
    const models = modelsIn(rows)
    if (models.length > 0) {
      // Without prices the recorded cost is used instead.
      try {
        prices = (await rpc.prices({ models })).prices ?? {}
      } catch {}
    }
    return formatSpend(spend(rows, prices))
  }

  const run = async () => {
    try {
      const next = await load()
      failing = false
      if (next !== text) {
        text = next
        options.onText(text)
      }
    } catch (error) {
      if (!failing) {
        failing = true
        options.log(`spend unavailable (is usage-view loaded?): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return {
    /** Coalesces concurrent calls into one. */
    refresh(): Promise<void> {
      return (pending ??= run().finally(() => {
        pending = undefined
      }))
    },
    /** Refreshes at most once per interval while sessions are working. */
    setWorking(working: boolean) {
      if (working && !timer) {
        timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
        timer.unref?.()
      } else if (!working && timer) {
        clearInterval(timer)
        timer = undefined
      }
    },
    stop() {
      clearInterval(timer)
      timer = undefined
    },
  }
}
