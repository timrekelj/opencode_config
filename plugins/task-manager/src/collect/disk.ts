import type { DiskInfo } from "../types"
import { run } from "./exec"

/** Parses `df -kP` output; one entry per distinct device, preferring the user data volume. */
export function parseDf(text: string): DiskInfo[] {
  const rows = text
    .split("\n")
    .slice(1)
    .map((line) => /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ device: m[1]!, total: Number(m[2]) * 1024, used: Number(m[3]) * 1024, free: Number(m[4]) * 1024, mount: m[5]! }))
  // On APFS the system and data volumes share one container; the data volume holds the used space.
  const data = rows.find((r) => r.mount === "/System/Volumes/Data")
  return rows
    .filter((r) => !(data && r.mount === "/"))
    .map(({ mount, total, used, free }) => ({ mount: mount === "/System/Volumes/Data" ? "/" : mount, total, used, free }))
}

export async function collectDisks(): Promise<DiskInfo[]> {
  const out = await run("df", ["-kP", "/", "/System/Volumes/Data"]).catch(() => run("df", ["-kP", "/"]))
  return parseDf(out)
}
