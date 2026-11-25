export function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
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

/**
 * Shortens a long name for a fixed-size control that cannot ellipsize on its own (e.g. a menu trigger button),
 * keeping both ends so the prefix and the distinctive tail survive: `feature/…/apple-wallet`.
 */
export function ellipsizeMiddle(name: string, max = 32): string {
  if (name.length <= max) return name
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`
}
