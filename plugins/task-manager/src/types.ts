export type HistoryPoint = {
  t: number
  /** Total CPU use, 0-100. */
  cpu: number
  memUsed: number
  /** 1 normal, 2 warning, 4 critical. */
  memPressure: number
  gpu: number | null
  /** Bytes per second. */
  netRx: number
  netTx: number
  swapUsed: number
}

export type HostInfo = {
  hostname: string
  model?: string
  chip?: string
  osVersion: string
  uptime: number
  cores: number
}

export type CpuInfo = {
  total: number
  user: number
  system: number
  idle: number
  perCore: number[]
  load: [number, number, number]
}

export type MemoryInfo = {
  total: number
  used: number
  app: number
  wired: number
  compressed: number
  cached: number
  free: number
  swapTotal: number
  swapUsed: number
  /** 1 normal, 2 warning, 4 critical. */
  pressure: number
}

export type GpuInfo = {
  name?: string
  cores?: number
  utilization: number
  renderer?: number
  tiler?: number
  memoryInUse?: number
  memoryAllocated?: number
}

export type NetworkInfo = {
  rxRate: number
  txRate: number
  rxTotal: number
  txTotal: number
}

export type DiskInfo = { mount: string; total: number; used: number; free: number }

export type PowerInfo = {
  /** False on machines without a battery. */
  hasBattery: boolean
  battery?: number
  charging?: boolean
  source?: string
  timeRemainingMin?: number
  thermalLevel: "nominal" | "warning"
  /** CPU speed limit in percent when throttled. */
  cpuSpeedLimit?: number
  /**
   * charging: charging; charged: full on AC; holding: on AC, battery idle (optimized charging or charge limit);
   * discharging: on battery; ac-draining: on AC but the battery still discharges (weak adapter or heavy load);
   * ac: external power without a battery.
   */
  state?: "charging" | "charged" | "holding" | "discharging" | "ac-draining" | "ac"
  /** Signed battery flow in watts: positive into the battery, negative out of it. */
  batteryWatts?: number
  adapter?: { watts: number; name?: string }
  health?: { cycleCount: number; designCapacity: number; maxCapacity: number; healthPercent: number }
  temperatureC?: number
  /** Total system power in watts (PowerTelemetryData.SystemLoad). */
  systemPowerW?: number
}

export type Snapshot = {
  at: number
  host: HostInfo
  cpu?: CpuInfo
  memory?: MemoryInfo
  gpu?: GpuInfo
  network?: NetworkInfo
  disks?: DiskInfo[]
  power?: PowerInfo
  history?: HistoryPoint[]
  errors?: Record<string, string>
}

export type ProcessInfo = {
  pid: number
  ppid: number
  name: string
  command: string
  user: string
  /** Percent of one core (can exceed 100). */
  cpu: number
  /** Resident memory in bytes. */
  memory: number
  /** Seconds since start. */
  elapsed: number
  /** The OpenCode server or one of its descendants. */
  opencode: boolean
  /** The OpenCode server process itself. */
  self: boolean
}

export type ProcessList = { at: number; total: number; processes: ProcessInfo[] }

export type PortInfo = {
  port: number
  address: string
  protocol: string
  pid: number
  name: string
  opencode: boolean
}

export type PortList = { at: number; ports: PortInfo[] }

export type KillResult = { ok: boolean; message: string }
