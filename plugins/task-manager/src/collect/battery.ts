import type { PowerInfo } from "../types"

type Value = string | number | boolean | Value[] | { [key: string]: Value } | null
type Dict = { [key: string]: Value }

const TOKEN = /<(\/?)(dict|array|key|string|integer|real|true|false|data|date)\s*(\/?)>|([^<]+)/g
const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")

/** Converts a 64-bit unsigned decoded integer to its signed value (two's complement). */
function integer(text: string): number {
  const n = BigInt(text.trim())
  return Number(n >= 1n << 63n ? n - (1n << 64n) : n)
}

/** Minimal parser for the XML property list that `ioreg -a` prints. Returns the first top-level dict. */
export function parsePlist(xml: string): Dict | undefined {
  const tokens = [...xml.matchAll(TOKEN)].filter((t) => t[4] === undefined || t[4].trim() !== "")
  let i = 0
  const parse = (kind: string): Value => {
    // Called after the opening tag of a container or the opening tag of a scalar has been consumed.
    if (kind === "dict") {
      const out: Dict = {}
      while (i < tokens.length) {
        const t = tokens[i++]
        if (t[2] === "dict" && t[1]) return out
        if (t[2] === "key" && !t[1]) {
          const key = unescape(tokens[i++]?.[4] ?? "")
          i++ // </key>
          out[key] = value()
        }
      }
      return out
    }
    if (kind === "array") {
      const out: Value[] = []
      while (i < tokens.length) {
        const t = tokens[i]
        if (t[2] === "array" && t[1]) {
          i++
          return out
        }
        out.push(value())
      }
      return out
    }
    return null
  }
  const value = (): Value => {
    const t = tokens[i++]
    if (!t || !t[2]) return value()
    const kind = t[2]
    if (t[3]) return kind === "true" ? true : kind === "false" ? false : kind === "dict" ? {} : kind === "array" ? [] : ""
    if (kind === "true") return true
    if (kind === "false") return false
    if (kind === "dict" || kind === "array") return parse(kind)
    const text = tokens[i]?.[4] !== undefined ? tokens[i++][4] : ""
    i++ // closing tag
    if (kind === "integer") return integer(text)
    if (kind === "real") return Number(text)
    return unescape(text)
  }
  // Skip to the first <dict> inside the root array/plist.
  while (i < tokens.length && tokens[i][2] !== "dict") i++
  if (i >= tokens.length) return undefined
  i++
  return parse("dict") as Dict
}

const dict = (v: Value | undefined): Dict | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined)
const num = (v: Value | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const flag = (v: Value | undefined): boolean | undefined =>
  typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : undefined

/** Amperage noise below which the battery counts as idle (mA). */
const IDLE_MA = 50

export type BatteryExtras = Pick<
  PowerInfo,
  "state" | "batteryWatts" | "adapter" | "health" | "temperatureC" | "systemPowerW"
>

/** Reads `ioreg -rw0 -c AppleSmartBattery -a` output. Returns nothing without a battery. */
export function parseBattery(xml: string): BatteryExtras | undefined {
  const root = parsePlist(xml)
  if (!root) return undefined
  const external = flag(root.ExternalConnected) ?? false
  const percent = num(root.CurrentCapacity)
  const amps = num(root.InstantAmperage) ?? num(root.Amperage) ?? 0
  const volts = num(root.Voltage)
  const out: BatteryExtras = {}

  if (volts !== undefined) out.batteryWatts = Math.round(((volts * amps) / 1_000_000) * 10) / 10

  const charging = flag(root.IsCharging) ?? false
  const full = flag(root.FullyCharged) ?? false
  if (!external) out.state = "discharging"
  else if (amps < -IDLE_MA) out.state = "ac-draining"
  else if (charging) out.state = "charging"
  else if (full || (percent !== undefined && percent >= 100)) out.state = "charged"
  else out.state = "holding"

  const details = dict(root.AdapterDetails)
  const watts = num(details?.Watts)
  if (external && details && watts) {
    out.adapter = { watts, name: typeof details.Name === "string" ? details.Name.trim() || undefined : undefined }
  }

  const data = dict(root.BatteryData)
  const design = num(data?.DesignCapacity) ?? num(root.DesignCapacity)
  const max = num(data?.AppleRawMaxCapacity) ?? num(data?.FullChargeCapacity) ?? num(root.AppleRawMaxCapacity)
  const cycles = num(root.CycleCount) ?? num(data?.CycleCount)
  if (design && max && cycles !== undefined) {
    out.health = {
      cycleCount: cycles,
      designCapacity: design,
      maxCapacity: max,
      healthPercent: Math.round((max / design) * 1000) / 10,
    }
  }

  // Temperature is in centi-°C; the telemetry keys are 0 on some machines, so only report plausible values.
  const temp = num(root.Temperature) ?? num(root.VirtualTemperature)
  if (temp !== undefined && temp > 0 && temp < 15000) out.temperatureC = Math.round(temp) / 100

  // PowerTelemetryData.SystemLoad is in mW (equals SystemVoltageIn mV x SystemCurrentIn mA).
  const load = num(dict(root.PowerTelemetryData)?.SystemLoad)
  if (load !== undefined && load > 0) out.systemPowerW = Math.round(load / 100) / 10
  return out
}
