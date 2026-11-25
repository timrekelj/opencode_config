import type { GpuInfo } from "../types"
import { run } from "./exec"

/** Parses the PerformanceStatistics dictionaries of `ioreg -r -d 1 -c IOAccelerator`. */
export function parseGpuStats(text: string): Omit<GpuInfo, "name" | "cores"> | undefined {
  const line = text.split("\n").find((l) => l.includes('"PerformanceStatistics"') && l.includes("Device Utilization"))
  if (!line) return undefined
  const num = (key: string) => {
    const m = new RegExp(`"${key}"=(\\d+)`).exec(line)
    return m ? Number(m[1]) : undefined
  }
  const utilization = num("Device Utilization %")
  if (utilization === undefined) return undefined
  return {
    utilization,
    renderer: num("Renderer Utilization %"),
    tiler: num("Tiler Utilization %"),
    memoryInUse: num("In use system memory"),
    memoryAllocated: num("Alloc system memory"),
  }
}

/** Parses `system_profiler SPDisplaysDataType -json` for the GPU name and core count. */
export function parseGpuInfo(text: string): { name?: string; cores?: number } {
  const data = JSON.parse(text) as { SPDisplaysDataType?: Array<Record<string, unknown>> }
  const gpu = data.SPDisplaysDataType?.[0]
  if (!gpu) return {}
  const name = (gpu.sppci_model ?? gpu._name) as string | undefined
  const cores = Number(gpu.sppci_cores)
  return { name, cores: Number.isFinite(cores) && cores > 0 ? cores : undefined }
}

let info: Promise<{ name?: string; cores?: number }> | undefined
/** system_profiler is slow, so it runs once. */
export const gpuInfo = () =>
  (info ??= run("system_profiler", ["SPDisplaysDataType", "-json"], 30_000).then(parseGpuInfo, () => {
    info = undefined
    return {}
  }))

export async function collectGpu(): Promise<GpuInfo | undefined> {
  const stats = parseGpuStats(await run("ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"]))
  if (!stats) return undefined
  return { ...(await gpuInfo()), ...stats }
}
