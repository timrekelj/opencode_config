import type { HistoryPoint, PowerInfo, Snapshot } from "../types"

const UNITS = ["B", "KB", "MB", "GB", "TB"]

export function bytes(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return "–"
  let n = Math.max(0, value)
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(digits)} ${UNITS[i]}`
}

export const rate = (value: number | undefined) => (value === undefined ? "–" : `${bytes(value)}/s`)

export function pct(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return "–"
  return `${value.toFixed(digits)}%`
}

export function duration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "–"
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function minutes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "–"
  const h = Math.floor(value / 60)
  const m = Math.round(value % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const pressureLabel = (pressure: number | undefined): "normal" | "warning" | "critical" =>
  pressure === 4 ? "critical" : pressure === 2 ? "warning" : "normal"

/** History keeps ten minutes; at one point every two seconds that is 300. */
export const HISTORY_MS = 10 * 60 * 1000

export function pointOf(snapshot: Snapshot): HistoryPoint | undefined {
  if (!snapshot.cpu && !snapshot.memory) return
  return {
    t: snapshot.at,
    cpu: snapshot.cpu?.total ?? 0,
    memUsed: snapshot.memory?.used ?? 0,
    memPressure: snapshot.memory?.pressure ?? 1,
    gpu: snapshot.gpu?.utilization ?? null,
    netRx: snapshot.network?.rxRate ?? 0,
    netTx: snapshot.network?.txRate ?? 0,
    swapUsed: snapshot.memory?.swapUsed ?? 0,
  }
}

/** Appends the point of a newer snapshot and drops what is older than the window. */
export function append(history: HistoryPoint[], snapshot: Snapshot): HistoryPoint[] {
  const point = pointOf(snapshot)
  if (!point) return history
  const last = history.at(-1)
  if (last && point.t <= last.t) return history
  const from = point.t - HISTORY_MS
  return [...history, point].filter((p) => p.t >= from)
}

/** Signed watts, e.g. "+23 W" or "−8 W" (true minus sign). */
export function signedWatts(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "–"
  const abs = Math.abs(value)
  const text = abs >= 10 ? Math.round(abs).toString() : abs.toFixed(1)
  return `${value < 0 ? "\u2212" : "+"}${text} W`
}

export type PowerLine = { text: string; hint?: string; warn?: boolean }

/** Source and state wording for the Power card. */
export function powerLine(power: PowerInfo): PowerLine {
  const flow = power.batteryWatts !== undefined ? ` \u00b7 ${signedWatts(power.batteryWatts)}` : ""
  switch (power.state) {
    case "charging":
      return { text: `Charging${flow}` }
    case "charged":
      return { text: "Charged", hint: "On AC power and the battery is full." }
    case "holding":
      return {
        text: `Holding at ${Math.round(power.battery ?? 0)}% \u2014 on AC, battery idle`,
        hint: "External power is connected but the battery is not charging: optimized charging or a charge limit is holding it here.",
      }
    case "discharging":
      return { text: `On battery${flow}` }
    case "ac-draining":
      return {
        text: `AC power, battery still draining${flow}`,
        hint: power.adapter ? `Adapter (${power.adapter.watts} W) can't keep up with the load` : "The adapter can't keep up with the load",
        warn: true,
      }
    default:
      if (power.charging) return { text: "Charging" }
      return { text: power.source?.includes("AC") ? "On AC power" : "On battery" }
  }
}

export const powerSource = (power: PowerInfo): string => {
  if (power.state === "discharging") return "Battery"
  if (power.state) return "AC adapter"
  return power.source?.includes("AC") ? "AC adapter" : power.source ? "Battery" : "AC adapter"
}
