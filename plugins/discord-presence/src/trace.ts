import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type TraceKind = "connected" | "disconnected" | "shown" | "cleared" | "closed"

export const defaultTracePath = () => join(homedir(), ".local", "share", "opencode", "log", "discord-presence.log")

/** Appends one JSON line per presence transition. Never throws. */
export function createTrace(path: string = defaultTracePath(), pid: number = process.pid) {
  return (kind: TraceKind, reason?: string) => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      const line = { time: new Date().toISOString(), pid, kind, ...(reason ? { reason } : {}) }
      appendFileSync(path, JSON.stringify(line) + "\n")
    } catch {}
  }
}
