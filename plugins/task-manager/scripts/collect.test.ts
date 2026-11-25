import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { cpuUsage } from "../src/collect/cpu"
import { parseDf } from "../src/collect/disk"
import { parseGpuInfo, parseGpuStats } from "../src/collect/gpu"
import { buildMemory, parseSwap, parseVmStat } from "../src/collect/memory"
import { parseNetstat } from "../src/collect/network"
import { parseBattery } from "../src/collect/battery"
import { parsePower } from "../src/collect/power"
import { buildProcesses, descendants, parseArgs, parseElapsed, parseLsof, parsePs } from "../src/collect/processes"
import { killGuard, killProcess } from "../src/kill"

const vmStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    38696.
Pages active:                                 309480.
Pages inactive:                               277751.
Pages speculative:                             30185.
Pages throttled:                                   0.
Pages wired down:                             314064.
Pages purgeable:                                  12.
"Translation faults":                     1731197001.
File-backed pages:                            269406.
Anonymous pages:                              348010.
Pages stored in compressor:                  1241591.
Pages occupied by compressor:                 561463.
`

describe("memory", () => {
  test("vm_stat", () => {
    const { pageSize, pages } = parseVmStat(vmStat)
    expect(pageSize).toBe(16384)
    expect(pages["pages free"]).toBe(38696)
    expect(pages["translation faults"]).toBe(1731197001)
  })
  test("swap", () => {
    expect(parseSwap("total = 9216.00M  used = 8748.62M  free = 467.38M  (encrypted)")).toEqual({
      total: 9216 * 1048576,
      used: Math.round(8748.62 * 1048576),
    })
    expect(parseSwap("")).toEqual({ total: 0, used: 0 })
  })
  test("breakdown", () => {
    const m = buildMemory({ vmStat, total: 25769803776, swap: "total = 1.00G used = 0.00M free = 1.00G", pressure: 2 })
    expect(m.wired).toBe(314064 * 16384)
    expect(m.compressed).toBe(561463 * 16384)
    expect(m.app).toBe((348010 - 12) * 16384)
    expect(m.used).toBe(m.app + m.wired + m.compressed)
    expect(m.pressure).toBe(2)
    expect(m.swapTotal).toBe(1024 ** 3)
  })
})

describe("cpu", () => {
  test("deltas", () => {
    const a = [{ user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }, { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 }]
    const b = [{ user: 50, nice: 0, sys: 25, idle: 25, irq: 0 }, { user: 10, nice: 0, sys: 10, idle: 180, irq: 0 }]
    const r = cpuUsage(a, b)
    expect(r.perCore).toEqual([75, 0])
    expect(r.total).toBeCloseTo(37.5)
    expect(r.user).toBeCloseTo(25)
    expect(r.system).toBeCloseTo(12.5)
  })
  test("no elapsed time", () => {
    const t = [{ user: 1, nice: 0, sys: 1, idle: 1, irq: 0 }]
    expect(cpuUsage(t, t).total).toBe(0)
  })
})

describe("gpu", () => {
  test("ioreg", () => {
    const text = `    | {
    |   "IOClass" = "AGXAcceleratorG16X"
    |   "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=6758563840,"Tiler Utilization %"=7,"recoveryCount"=0,"Renderer Utilization %"=48,"Device Utilization %"=48,"In use system memory"=2348204032}
    | }`
    expect(parseGpuStats(text)).toEqual({
      utilization: 48,
      renderer: 48,
      tiler: 7,
      memoryInUse: 2348204032,
      memoryAllocated: 6758563840,
    })
    expect(parseGpuStats("nothing")).toBeUndefined()
  })
  test("system_profiler", () => {
    const json = JSON.stringify({ SPDisplaysDataType: [{ _name: "Apple M4 Pro", sppci_cores: "16", sppci_model: "Apple M4 Pro" }] })
    expect(parseGpuInfo(json)).toEqual({ name: "Apple M4 Pro", cores: 16 })
    expect(parseGpuInfo("{}")).toEqual({})
  })
})

describe("network", () => {
  test("sums physical interfaces only", () => {
    const text = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                      13361863     0 36736232351 13361863     0 36736232351     0
lo0        16384 127           127.0.0.1       13361863     - 36736232351 13361863     - 36736232351     -
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
en0        1500  <Link#14>   aa:bb:cc:dd:ee:ff  5000     0       1000     4000     0       2000     0
en0        1500  192.168.1.2 192.168.1.2        5000     -       1000     4000     -       2000     -
en1        1500  <Link#15>   aa:bb:cc:dd:ee:00  50     0       10     40     0       20     0
utun0      1380  <Link#16>                      900     0       9999     900     0       9999     0
anpi2      1500  <Link#4>    02:00:00:00:00:00        0     0          0        0     0          0     0`
    expect(parseNetstat(text)).toEqual({ rx: 1010, tx: 2020 })
  })
})

describe("disk", () => {
  test("prefers the data volume on APFS", () => {
    const text = `Filesystem     1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s1s1   482797652  13439312 101776548    12%    /
/dev/disk3s5     482797652 347020184 101776548    78%    /System/Volumes/Data`
    const disks = parseDf(text)
    expect(disks).toEqual([{ mount: "/", total: 482797652 * 1024, used: 347020184 * 1024, free: 101776548 * 1024 }])
  })
  test("keeps root when there is no data volume", () => {
    const text = `Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk1s1 1000 400 600 40% /`
    expect(parseDf(text)).toEqual([{ mount: "/", total: 1024000, used: 409600, free: 614400 }])
  })
})

describe("power", () => {
  const therm = "Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded"
  test("ac, not charging", () => {
    const p = parsePower(
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=22741091)\t90%; AC attached; not charging present: true\n",
      therm,
    )
    expect(p).toMatchObject({ hasBattery: true, battery: 90, charging: false, source: "AC Power", thermalLevel: "nominal" })
    expect(p.timeRemainingMin).toBeUndefined()
  })
  test("discharging with estimate", () => {
    const p = parsePower("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t63%; discharging; 4:23 remaining present: true\n", therm)
    expect(p).toMatchObject({ battery: 63, charging: false, timeRemainingMin: 263 })
  })
  test("charging, no estimate yet", () => {
    const p = parsePower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t40%; charging; (no estimate) present: true\n", therm)
    expect(p).toMatchObject({ charging: true })
    expect(p.timeRemainingMin).toBeUndefined()
  })
  test("desktop and throttling", () => {
    const p = parsePower("Now drawing from 'AC Power'\n", "CPU_Speed_Limit \t= 70\n")
    expect(p).toMatchObject({ hasBattery: false, thermalLevel: "warning", cpuSpeedLimit: 70 })
  })
})

describe("battery (ioreg)", () => {
  const entry = (v: unknown) =>
    typeof v === "boolean"
      ? v ? "<true/>" : "<false/>"
      : typeof v === "bigint"
        ? `<integer>${v}</integer>`
        : typeof v === "string"
        ? `<string>${v}</string>`
        : typeof v === "object"
          ? `<dict>${Object.entries(v as object).map(([k, x]) => `<key>${k}</key>${entry(x)}`).join("")}</dict>`
          : `<integer>${v}</integer>`
  const plist = (o: object) => `<?xml version="1.0"?><plist version="1.0"><array>${entry(o)}</array></plist>`
  const base = {
    ExternalConnected: true,
    IsCharging: false,
    FullyCharged: false,
    CurrentCapacity: 60,
    CycleCount: 100,
    Voltage: 12000,
    InstantAmperage: 0,
    AdapterDetails: { Watts: 68, Name: "70W USB-C Power Adapter " },
    BatteryData: { DesignCapacity: 6000, AppleRawMaxCapacity: 5400 },
  }
  const batt = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t60%; AC attached; not charging present: true\n"
  const therm = ""

  test("holding (real capture)", () => {
    const xml = readFileSync(new URL("./fixtures/applesmartbattery-holding.xml", import.meta.url), "utf8")
    const b = parseBattery(xml)!
    expect(b.state).toBe("holding")
    expect(b.batteryWatts).toBe(0)
    expect(b.adapter).toEqual({ watts: 68, name: "70W USB-C Power Adapter" })
    expect(b.health).toEqual({ cycleCount: 169, designCapacity: 6249, maxCapacity: 5492, healthPercent: 87.9 })
    expect(b.systemPowerW).toBeGreaterThan(0)
    const p = parsePower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t90%; AC attached; not charging present: true\n", therm, xml)
    expect(p).toMatchObject({ state: "holding", charging: false, battery: 90, source: "AC Power" })
  })
  test("charging", () => {
    const b = parseBattery(plist({ ...base, IsCharging: true, InstantAmperage: 2000 }))!
    expect(b.state).toBe("charging")
    expect(b.batteryWatts).toBe(24)
    const p = parsePower(batt.replace("not charging", "charging"), therm, plist({ ...base, IsCharging: true, InstantAmperage: 2000 }))
    expect(p.charging).toBe(true)
  })
  test("charged", () => {
    expect(parseBattery(plist({ ...base, CurrentCapacity: 100, FullyCharged: true }))!.state).toBe("charged")
  })
  test("discharging on battery", () => {
    const b = parseBattery(plist({ ...base, ExternalConnected: false, InstantAmperage: -1000, AdapterDetails: {} }))!
    expect(b.state).toBe("discharging")
    expect(b.batteryWatts).toBe(-12)
    expect(b.adapter).toBeUndefined()
  })
  test("ac-draining, signed and unsigned-encoded negative amperage", () => {
    const signed = parseBattery(plist({ ...base, InstantAmperage: -700 }))!
    expect(signed).toMatchObject({ state: "ac-draining", batteryWatts: -8.4 })
    const unsigned = parseBattery(plist({ ...base, InstantAmperage: 2n ** 64n - 700n }))!
    expect(unsigned).toMatchObject({ state: "ac-draining", batteryWatts: -8.4 })
    expect(parseBattery(plist({ ...base, InstantAmperage: -20 }))!.state).toBe("holding")
  })
  test("no battery", () => {
    const p = parsePower("Now drawing from 'AC Power'\n", therm)
    expect(p).toMatchObject({ hasBattery: false, state: "ac" })
    expect(parsePower("Now drawing from 'AC Power'\n", therm, "")).toMatchObject({ hasBattery: false })
  })
  test("garbage ioreg keeps pmset data", () => {
    expect(parsePower(batt, therm, "not xml")).toMatchObject({ hasBattery: true, battery: 60 })
  })
})

describe("processes", () => {
  const ps = `    1     0   0.1   8240 02-03:18:04 root             /sbin/launchd
  115 99956   0.0  12160    01:16:24 timrekelj        /Applications/Discord.app/Contents/Frameworks/Discord Helper.app/Contents/MacOS/Discord Helper
  200     1  12.5  20480       05:09 timrekelj        /opt/homebrew/bin/opencode
  201   200   3.0  10240          0:07 timrekelj        /bin/zsh
  202   201   1.0   1024       00:01 timrekelj        /usr/bin/bun`
  const args = `    1 /sbin/launchd
  115 /Applications/Discord.app/Contents/Frameworks/Discord Helper.app/Contents/MacOS/Discord Helper --type=utility
  200 opencode serve --port 4096
  202 bun run dev`

  test("elapsed", () => {
    expect(parseElapsed("02-03:18:04")).toBe(2 * 86400 + 3 * 3600 + 18 * 60 + 4)
    expect(parseElapsed("01:16:24")).toBe(4584)
    expect(parseElapsed("05:09")).toBe(309)
    expect(parseElapsed("garbage")).toBe(0)
  })
  test("ps rows with spaces in the path", () => {
    const rows = parsePs(ps)
    expect(rows).toHaveLength(5)
    expect(rows[1]).toMatchObject({ pid: 115, ppid: 99956, name: "Discord Helper", memory: 12160 * 1024, user: "timrekelj" })
  })
  test("args join, truncation", () => {
    const map = parseArgs(args + "\n  300 " + "x".repeat(900))
    expect(map.get(200)).toBe("opencode serve --port 4096")
    expect(map.get(300)!.length).toBe(501)
  })
  test("ppid tree tagging", () => {
    const list = buildProcesses(parsePs(ps), parseArgs(args), 200)
    expect(list.map((p) => p.pid)).toEqual([200, 201, 202, 1, 115]) // cpu desc
    expect(Object.fromEntries(list.map((p) => [p.pid, p.opencode]))).toEqual({ 1: false, 115: false, 200: true, 201: true, 202: true })
    expect(list.filter((p) => p.self).map((p) => p.pid)).toEqual([200])
    expect(list.find((p) => p.pid === 202)!.command).toBe("bun run dev")
  })
  test("descendants survives cycles and self parents", () => {
    expect([...descendants([{ pid: 1, ppid: 1 }, { pid: 2, ppid: 3 }, { pid: 3, ppid: 2 }], 2)].sort()).toEqual([2, 3])
  })
})

describe("ports", () => {
  const lsof = `p617
crapportd
Ltimrekelj
f11
PTCP
n*:55998
f12
PTCP
n*:55998
f21
PTCP
n[::1]:50928
p647
copencode
Ltimrekelj
f9
PTCP
n127.0.0.1:4096
f10
PTCP
n127.0.0.1:4096
`
  test("dedupes and marks opencode", () => {
    const ports = parseLsof(lsof, new Set([647]))
    expect(ports).toEqual([
      { port: 4096, address: "127.0.0.1", protocol: "TCP", pid: 647, name: "opencode", opencode: true },
      { port: 50928, address: "::1", protocol: "TCP", pid: 617, name: "rapportd", opencode: false },
      { port: 55998, address: "*", protocol: "TCP", pid: 617, name: "rapportd", opencode: false },
    ])
  })
})

describe("kill guards", () => {
  test("refuses protected pids", () => {
    expect(killGuard(1, 500, 400)).toMatch(/pid 1/)
    expect(killGuard(0, 500, 400)).toMatch(/Invalid/)
    expect(killGuard(-5, 500, 400)).toMatch(/Invalid/)
    expect(killGuard(1.5, 500, 400)).toMatch(/Invalid/)
    expect(killGuard("12", 500, 400)).toMatch(/Invalid/)
    expect(killGuard(500, 500, 400)).toMatch(/OpenCode server/)
    expect(killGuard(400, 500, 400)).toMatch(/parent/)
    expect(killGuard(777, 500, 400)).toBeUndefined()
  })
  test("signals and maps errors", () => {
    const sent: unknown[] = []
    expect(killProcess(777, false, (p, s) => sent.push([p, s]), 500, 400)).toBe("Sent SIGTERM to process 777.")
    expect(killProcess(777, true, (p, s) => sent.push([p, s]), 500, 400)).toBe("Sent SIGKILL to process 777.")
    expect(sent).toEqual([[777, "SIGTERM"], [777, "SIGKILL"]])
    const thrower = (code: string) => () => {
      throw Object.assign(new Error(code), { code })
    }
    expect(() => killProcess(777, false, thrower("ESRCH"), 500, 400)).toThrow(/no longer exists/)
    expect(() => killProcess(777, false, thrower("EPERM"), 500, 400)).toThrow(/Not permitted/)
    expect(() => killProcess(500, false, () => {}, 500, 400)).toThrow(/OpenCode server/)
  })
})
