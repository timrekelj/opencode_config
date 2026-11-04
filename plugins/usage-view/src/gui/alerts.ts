import type { Context } from "@opencode/plugin/gui"
import type { LimitsResult } from "../types"
import { loadLimits } from "./api"
import { percent, until } from "./format"

/** The Anthropic usage endpoint is rate limited per token: check every few minutes, not more. */
const CHECK_MS = 5 * 60 * 1000
const FIRST_CHECK_MS = 20 * 1000
const DEFAULT_THRESHOLDS = [80, 95]

interface Alert {
  /** One key per window, threshold and reset, so each crossing warns once. */
  key: string
  title: string
  description: string
  danger: boolean
}

export function parseThresholds(value: unknown): number[] {
  if (value === false) return []
  const list = Array.isArray(value) ? value : typeof value === "number" ? [value] : DEFAULT_THRESHOLDS
  return [...new Set(list.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 100))].sort((a, b) => a - b)
}

/** The windows at or past a threshold, each with only the highest threshold it crossed. */
export function alertsFor(result: LimitsResult, thresholds: number[]): Alert[] {
  const alerts: Alert[] = []
  const highest = thresholds.at(-1)
  for (const provider of result.providers) {
    if (provider.error) continue
    for (const window of provider.windows) {
      const crossed = thresholds.filter((t) => window.usedPercent >= t).at(-1)
      if (crossed === undefined) continue
      const left = percent(Math.max(0, 1 - window.usedPercent / 100))
      alerts.push({
        key: `${provider.id}:${window.id}:${window.resetsAt ?? "none"}:${crossed}`,
        title: `${provider.label}: ${Math.round(window.usedPercent)}% of ${window.label} used`,
        description: window.resetsAt ? `${left} left, resets ${until(window.resetsAt)}.` : `${left} left.`,
        danger: crossed === highest || window.usedPercent >= 100,
      })
    }
  }
  return alerts
}

/**
 * Checks the subscription limits in the background and shows a toast when a window crosses a threshold, whether or not
 * the Usage panel is open. Each crossing warns once per window reset; a window reload may warn once more.
 */
export function startAlerts(ctx: Context, openLimits: () => void) {
  const thresholds = parseThresholds(ctx.options.alerts)
  if (thresholds.length === 0) return
  const [seen, setSeen] = ctx.storage.memory("alerts", { initial: { keys: {} as Record<string, true> } })

  const check = async () => {
    try {
      const result = await loadLimits(ctx, { directory: ctx.sessions.current()?.directory }, new AbortController().signal)
      for (const alert of alertsFor(result, thresholds)) {
        if (seen.keys[alert.key]) continue
        setSeen((draft) => void (draft.keys[alert.key] = true))
        ctx.toast.show({
          title: alert.title,
          description: alert.description,
          variant: alert.danger ? "error" : "default",
          icon: "warning",
          persistent: true,
          actions: [{ label: "Show limits", run: openLimits }],
        })
      }
    } catch {
      // Not signed in, offline or rate limited: the Limits view shows why; stay quiet here.
    }
  }

  const first = setTimeout(check, FIRST_CHECK_MS)
  const timer = setInterval(check, CHECK_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
