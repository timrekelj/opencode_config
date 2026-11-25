import { Rpc } from "@opencode/plugin/rpc"

const str = { type: "string" } as const
const num = { type: "number" } as const
const bool = { type: "boolean" } as const

const errors = { failed: { type: "object", properties: { message: str } } } as const

const historyPoint = {
  type: "object",
  properties: {
    t: num,
    cpu: num,
    memUsed: num,
    memPressure: num,
    gpu: { anyOf: [num, { type: "null" }] },
    netRx: num,
    netTx: num,
    swapUsed: num,
  },
  required: ["t", "cpu", "memUsed", "memPressure", "gpu", "netRx", "netTx", "swapUsed"],
} as const

const snapshot = {
  type: "object",
  properties: {
    at: num,
    host: {
      type: "object",
      properties: { hostname: str, model: str, chip: str, osVersion: str, uptime: num, cores: num },
      required: ["hostname", "osVersion", "uptime", "cores"],
    },
    cpu: {
      type: "object",
      properties: {
        total: num,
        user: num,
        system: num,
        idle: num,
        perCore: { type: "array", items: num },
        load: { type: "array", items: num },
      },
    },
    memory: {
      type: "object",
      properties: {
        total: num,
        used: num,
        app: num,
        wired: num,
        compressed: num,
        cached: num,
        free: num,
        swapTotal: num,
        swapUsed: num,
        pressure: num,
      },
    },
    gpu: {
      type: "object",
      properties: { name: str, cores: num, utilization: num, renderer: num, tiler: num, memoryInUse: num, memoryAllocated: num },
    },
    network: { type: "object", properties: { rxRate: num, txRate: num, rxTotal: num, txTotal: num } },
    disks: {
      type: "array",
      items: { type: "object", properties: { mount: str, total: num, used: num, free: num } },
    },
    power: {
      type: "object",
      properties: {
        hasBattery: bool,
        battery: num,
        charging: bool,
        source: str,
        timeRemainingMin: num,
        thermalLevel: { type: "string", enum: ["nominal", "warning"] },
        cpuSpeedLimit: num,
        state: { type: "string", enum: ["charging", "charged", "holding", "discharging", "ac-draining", "ac"] },
        batteryWatts: num,
        adapter: { type: "object", properties: { watts: num, name: str } },
        health: {
          type: "object",
          properties: { cycleCount: num, designCapacity: num, maxCapacity: num, healthPercent: num },
        },
        temperatureC: num,
        systemPowerW: num,
      },
    },
    history: { type: "array", items: historyPoint },
    errors: { type: "object", additionalProperties: str },
  },
  required: ["at", "host"],
} as const

export const TaskManager = Rpc.define({
  id: "task-manager",
  methods: {
    snapshot: {
      input: { type: "object", properties: { history: bool } },
      output: snapshot,
      errors,
    },
    processes: {
      input: { type: "object", properties: { limit: num } },
      output: {
        type: "object",
        properties: {
          at: num,
          total: num,
          processes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pid: num,
                ppid: num,
                name: str,
                command: str,
                user: str,
                cpu: num,
                memory: num,
                elapsed: num,
                opencode: bool,
                self: bool,
              },
              required: ["pid", "ppid", "name", "command", "user", "cpu", "memory", "elapsed", "opencode", "self"],
            },
          },
        },
        required: ["at", "total", "processes"],
      },
      errors,
    },
    ports: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: {
          at: num,
          ports: {
            type: "array",
            items: {
              type: "object",
              properties: { port: num, address: str, protocol: str, pid: num, name: str, opencode: bool },
              required: ["port", "address", "protocol", "pid", "name", "opencode"],
            },
          },
        },
        required: ["at", "ports"],
      },
      errors,
    },
    kill: {
      input: { type: "object", properties: { pid: num, force: bool }, required: ["pid"] },
      output: { type: "object", properties: { ok: bool, message: str }, required: ["ok", "message"] },
      errors,
    },
  },
  events: {},
})
