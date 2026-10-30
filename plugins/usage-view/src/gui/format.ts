import type { Price } from "../types"

export interface Tokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export const totalTokens = (t: Tokens | undefined) =>
  t ? t.input + t.output + t.reasoning + t.cache.read + t.cache.write : 0

export interface CostParts {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export const emptyParts = (): CostParts => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })

/** API-equivalent cost in USD by token type; undefined when the price is unknown. */
export const costParts = (t: Tokens, price: Price | null | undefined): CostParts | undefined =>
  price
    ? {
        input: (t.input * price.input) / 1e6,
        cacheRead: (t.cache.read * price.cacheRead) / 1e6,
        cacheWrite: (t.cache.write * price.cacheWrite) / 1e6,
        output: ((t.output + t.reasoning) * price.output) / 1e6,
      }
    : undefined

/** API-equivalent cost in USD; undefined when the price is unknown. */
export const estimate = (t: Tokens, price: Price | null | undefined): number | undefined => {
  const parts = costParts(t, price)
  return parts ? parts.input + parts.cacheRead + parts.cacheWrite + parts.output : undefined
}

/** What cache reads saved compared with paying the full input price for them. */
export const cacheSavings = (t: Tokens, price: Price | null | undefined): number =>
  price ? (t.cache.read * Math.max(0, price.input - price.cacheRead)) / 1e6 : 0

export function tokens(value: number): string {
  const abs = Math.abs(value)
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ]
  for (const [size, unit] of units) {
    if (abs >= size) {
      const scaled = value / size
      return `${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1))}${unit}`
    }
  }
  return String(Math.round(value))
}

export const exact = (value: number) => Math.round(value).toLocaleString()

export function dollars(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—"
  if (value > 0 && value < 0.01) return "<$0.01"
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const percent = (value: number) =>
  !Number.isFinite(value) ? "—" : value > 0 && value < 0.001 ? "<0.1%" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`

export function duration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** Time remaining until a future timestamp, e.g. "in 3h". */
export function until(time: number): string {
  const seconds = (time - Date.now()) / 1000
  if (seconds < 60) return "soon"
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "y"],
    [60 * 60 * 24 * 30, "mo"],
    [60 * 60 * 24 * 7, "w"],
    [60 * 60 * 24, "d"],
    [60 * 60, "h"],
    [60, "m"],
  ]
  for (const [size, unit] of units) if (seconds >= size) return `in ${Math.floor(seconds / size)}${unit}`
  return "soon"
}

export function ago(time: number): string {
  const seconds = Math.max(0, (Date.now() - time) / 1000)
  if (seconds < 60) return "just now"
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "y"],
    [60 * 60 * 24 * 30, "mo"],
    [60 * 60 * 24 * 7, "w"],
    [60 * 60 * 24, "d"],
    [60 * 60, "h"],
    [60, "m"],
  ]
  for (const [size, unit] of units) if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`
  return "just now"
}
