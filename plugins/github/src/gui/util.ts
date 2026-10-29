import type { IconName } from "@opencode/plugin/gui"
import type { CheckState, PrSummary, Rollup } from "../types"

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

export const checkIcon = (state: Rollup | CheckState): IconName =>
  state === "success"
    ? "circle-check"
    : state === "failure"
      ? "circle-x"
      : state === "pending"
        ? "status-active"
        : "circle-ban-sign"

export const checkLabel = (state: Rollup): string =>
  ({
    success: "All checks passed",
    failure: "Some checks failed",
    pending: "Checks running",
    skipped: "Checks skipped",
    neutral: "Checks neutral",
    none: "No checks",
  })[state]

export const stateLabel = (pr: Pick<PrSummary, "state" | "draft">) =>
  pr.state === "MERGED" ? "Merged" : pr.state === "CLOSED" ? "Closed" : pr.draft ? "Draft" : "Open"

export const stateClass = (pr: Pick<PrSummary, "state" | "draft">) =>
  pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.draft ? "draft" : "open"

export const avatar = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=48`

// --- unified diff ---------------------------------------------------------------------------------------------------

export interface DiffLine {
  kind: "hunk" | "add" | "del" | "ctx" | "note"
  text: string
  old?: number
  new?: number
}

export function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
      }
      lines.push({ kind: "hunk", text: raw })
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), new: newLine++ })
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", text: raw.slice(1), old: oldLine++ })
    } else if (raw.startsWith("\\")) {
      lines.push({ kind: "note", text: raw })
    } else {
      lines.push({ kind: "ctx", text: raw.slice(1), old: oldLine++, new: newLine++ })
    }
  }
  return lines
}

export const lineSide = (line: DiffLine) => (line.kind === "del" ? "LEFT" : "RIGHT") as "LEFT" | "RIGHT"
export const lineNumber = (line: DiffLine) => (line.kind === "del" ? line.old : line.new)
