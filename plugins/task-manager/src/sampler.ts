import { descendants } from "./collect/processes"
import { collectCpu, type CpuTimes } from "./collect/cpu"
import { collectDisks } from "./collect/disk"
import { message } from "./collect/exec"
import { collectGpu } from "./collect/gpu"
import { collectHost } from "./collect/host"
import { collectMemory } from "./collect/memory"
import { collectNetwork, type NetCounters } from "./collect/network"
import { collectPower } from "./collect/power"
import { collectPorts, collectProcesses } from "./collect/processes"
import type { CpuInfo, GpuInfo, HistoryPoint, MemoryInfo, NetworkInfo, PortList, ProcessInfo, ProcessList, Snapshot } from "./types"

export const ACTIVE_INTERVAL = 2000
export const IDLE_INTERVAL = 10_000
export const ACTIVE_WINDOW = 30_000
export const HISTORY_MS = 10 * 60_000
const PORTS_TTL = 3000
const DISK_TTL = 15_000
const POWER_TTL = 10_000

type Cached<T> = { at: number; value?: T; error?: string }

export class Sampler {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private stopped = false
  private lastTouch = 0
  private lastTick = 0

  private cpuTimes: CpuTimes[] | undefined
  private netPrev: { at: number; counters: NetCounters } | undefined
  private cpu: CpuInfo | undefined
  private memory: MemoryInfo | undefined
  private gpu: GpuInfo | undefined
  private network: NetworkInfo | undefined
  private processes: ProcessInfo[] = []
  private processesAt = 0
  private errors: Record<string, string> = {}
  private history: HistoryPoint[] = []
  private ports: Cached<PortList> | undefined
  private portsRunning: Promise<PortList> | undefined
  private slow = new Map<string, Cached<unknown>>()

  constructor(private selfPid = process.pid) {}

  start() {
    this.stopped = false
    this.cpuTimes = collectCpu(undefined).times
    this.schedule()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Marks the sampler active (fast interval) and returns whether it was idle. */
  touch() {
    this.lastTouch = Date.now()
  }

  get active() {
    return Date.now() - this.lastTouch < ACTIVE_WINDOW
  }

  private schedule() {
    if (this.stopped) return
    this.timer = setTimeout(
      () => {
        void this.tick().finally(() => this.schedule())
      },
      this.active ? ACTIVE_INTERVAL : IDLE_INTERVAL,
    )
    this.timer.unref?.()
  }

  /** One sampling pass. Overlapping calls share the pass in flight. */
  tick(): Promise<void> {
    if (this.running) return this.running
    this.running = this.sample().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async fresh(maxAge: number) {
    if (Date.now() - this.lastTick > maxAge) await this.tick()
    else if (this.running) await this.running
  }

  private async sample() {
    const now = Date.now()
    const errors: Record<string, string> = {}
    const fail = (key: string) => (error: unknown) => {
      errors[key] = message(error)
      return undefined
    }
    const [memory, gpu, net, processes] = await Promise.all([
      collectMemory().catch(fail("memory")),
      collectGpu().catch(fail("gpu")),
      collectNetwork().catch(fail("network")),
      collectProcesses(this.selfPid).catch(fail("processes")),
    ])
    try {
      const cpu = collectCpu(this.cpuTimes)
      this.cpuTimes = cpu.times
      this.cpu = cpu.info
    } catch (error) {
      errors.cpu = message(error)
    }
    if (memory) this.memory = memory
    else this.memory = undefined
    this.gpu = gpu
    if (net) {
      const prev = this.netPrev
      const dt = prev ? (now - prev.at) / 1000 : 0
      this.network = {
        rxRate: dt > 0 ? Math.max(0, (net.rx - prev!.counters.rx) / dt) : 0,
        txRate: dt > 0 ? Math.max(0, (net.tx - prev!.counters.tx) / dt) : 0,
        rxTotal: net.rx,
        txTotal: net.tx,
      }
      this.netPrev = { at: now, counters: net }
    } else this.network = undefined
    if (processes) {
      this.processes = processes
      this.processesAt = now
    }
    this.errors = errors
    this.lastTick = now
    this.history.push({
      t: now,
      cpu: this.cpu?.total ?? 0,
      memUsed: this.memory?.used ?? 0,
      memPressure: this.memory?.pressure ?? 1,
      gpu: this.gpu?.utilization ?? null,
      netRx: this.network?.rxRate ?? 0,
      netTx: this.network?.txRate ?? 0,
      swapUsed: this.memory?.swapUsed ?? 0,
    })
    const cutoff = now - HISTORY_MS
    let drop = 0
    while (drop < this.history.length && this.history[drop]!.t < cutoff) drop++
    if (drop) this.history.splice(0, drop)
  }

  private async cached<T>(key: string, ttl: number, fn: () => Promise<T>, errors: Record<string, string>) {
    const hit = this.slow.get(key) as Cached<T> | undefined
    if (!hit || Date.now() - hit.at > ttl) {
      const next: Cached<T> = { at: Date.now() }
      try {
        next.value = await fn()
      } catch (error) {
        next.error = message(error)
      }
      this.slow.set(key, next)
      if (next.error) errors[key] = next.error
      return next.value
    }
    if (hit.error) errors[key] = hit.error
    return hit.value
  }

  async snapshot(withHistory: boolean): Promise<Snapshot> {
    this.touch()
    await this.fresh(ACTIVE_INTERVAL + 500)
    const errors: Record<string, string> = { ...this.errors }
    const [host, disks, power] = await Promise.all([
      collectHost(),
      this.cached("disks", DISK_TTL, collectDisks, errors),
      this.cached("power", POWER_TTL, collectPower, errors),
    ])
    return {
      at: this.lastTick,
      host,
      cpu: this.cpu,
      memory: this.memory,
      gpu: this.gpu,
      network: this.network,
      disks,
      power,
      history: withHistory ? [...this.history] : undefined,
      errors: Object.keys(errors).length ? errors : undefined,
    }
  }

  async processList(limit?: number): Promise<ProcessList> {
    this.touch()
    await this.fresh(ACTIVE_INTERVAL + 500)
    if (!this.processesAt && this.errors.processes) throw new Error(this.errors.processes)
    const list = typeof limit === "number" && limit > 0 ? this.processes.slice(0, Math.floor(limit)) : this.processes
    return { at: this.processesAt, total: this.processes.length, processes: list }
  }

  async portList(): Promise<PortList> {
    this.touch()
    if (this.ports?.value && Date.now() - this.ports.at < PORTS_TTL) return this.ports.value
    this.portsRunning ??= (async () => {
      try {
        await this.fresh(ACTIVE_INTERVAL + 500)
        const tree = descendants(this.processes, this.selfPid)
        const value = { at: Date.now(), ports: await collectPorts(tree) }
        this.ports = { at: value.at, value }
        return value
      } finally {
        this.portsRunning = undefined
      }
    })()
    return this.portsRunning
  }
}
