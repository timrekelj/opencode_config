import type { MemoryInfo } from "../types"
import { run } from "./exec"

/** Parses `vm_stat` into byte counts per field name (lowercased, without the "pages" prefix). */
export function parseVmStat(text: string): { pageSize: number; pages: Record<string, number> } {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]) || 16384
  const pages: Record<string, number> = {}
  for (const line of text.split("\n")) {
    const m = /^"?([^":]+?)"?:\s+(\d+)\.?\s*$/.exec(line)
    if (m) pages[m[1]!.toLowerCase()] = Number(m[2])
  }
  return { pageSize, pages }
}

/** Parses `sysctl -n vm.swapusage`: "total = 9216.00M  used = 8748.62M  free = 467.38M  (encrypted)". */
export function parseSwap(text: string): { total: number; used: number } {
  const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 } as const
  const get = (key: string) => {
    const m = new RegExp(`${key}\\s*=\\s*([\\d.]+)\\s*([KMGT])`, "i").exec(text)
    return m ? Number(m[1]) * unit[m[2]!.toUpperCase() as keyof typeof unit] : 0
  }
  return { total: Math.round(get("total")), used: Math.round(get("used")) }
}

/** Builds Activity Monitor style memory figures. */
export function buildMemory(input: {
  vmStat: string
  total: number
  swap: string
  pressure: number
}): MemoryInfo {
  const { pageSize: ps, pages } = parseVmStat(input.vmStat)
  const bytes = (key: string) => (pages[key] ?? 0) * ps
  const purgeable = bytes("pages purgeable")
  const app = Math.max(0, bytes("anonymous pages") - purgeable)
  const wired = bytes("pages wired down")
  const compressed = bytes("pages occupied by compressor")
  const cached = bytes("file-backed pages") + purgeable
  const free = bytes("pages free")
  const swap = parseSwap(input.swap)
  return {
    total: input.total,
    used: Math.min(input.total, app + wired + compressed),
    app,
    wired,
    compressed,
    cached,
    free,
    swapTotal: swap.total,
    swapUsed: swap.used,
    pressure: input.pressure,
  }
}

export async function collectMemory(): Promise<MemoryInfo> {
  const [vmStat, sysctl, swap, pressure] = await Promise.all([
    run("vm_stat", []),
    run("sysctl", ["-n", "hw.memsize"]),
    run("sysctl", ["-n", "vm.swapusage"]).catch(() => ""),
    run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]).catch(() => "1"),
  ])
  return buildMemory({ vmStat, total: Number(sysctl.trim()), swap, pressure: Number(pressure.trim()) || 1 })
}
