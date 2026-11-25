import type { PowerInfo } from "../types"
import { parseBattery } from "./battery"
import { run } from "./exec"

/** Parses `pmset -g batt`, `pmset -g therm` and (optionally) `ioreg -a` battery data. */
export function parsePower(batt: string, therm: string, ioreg?: string): PowerInfo {
  const source = /Now drawing from '([^']+)'/.exec(batt)?.[1]
  const line = batt.split("\n").find((l) => l.includes("InternalBattery"))
  const power: PowerInfo = { hasBattery: !!line, source, thermalLevel: "nominal" }
  if (line) {
    const body = line.split("\t")[1] ?? line
    const percent = /(\d+)%/.exec(body)
    if (percent) power.battery = Number(percent[1])
    power.charging = /;\s*(charging|finishing charge)/.test(body) && !/not charging/.test(body)
    const time = /(\d+):(\d+) remaining/.exec(body)
    if (time && !/\(no estimate\)/.test(body)) power.timeRemainingMin = Number(time[1]) * 60 + Number(time[2])
  }
  if (ioreg) {
    try {
      const extras = parseBattery(ioreg)
      if (extras && power.hasBattery) {
        Object.assign(power, extras)
        power.charging = extras.state === "charging"
      }
    } catch {
      // ioreg data is optional.
    }
  } else if (!power.hasBattery && source && /AC/i.test(source)) power.state = "ac"
  const limit = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(therm)
  if (limit && Number(limit[1]) < 100) {
    power.cpuSpeedLimit = Number(limit[1])
    power.thermalLevel = "warning"
  }
  if (/Thermal warning level:\s*[1-9]|CPU_Scheduler_Limit\s*=\s*(?!100)\d+/i.test(therm)) power.thermalLevel = "warning"
  return power
}

export async function collectPower(): Promise<PowerInfo> {
  const [batt, therm, ioreg] = await Promise.all([
    run("pmset", ["-g", "batt"]),
    run("pmset", ["-g", "therm"]).catch(() => ""),
    run("ioreg", ["-rw0", "-c", "AppleSmartBattery", "-a"]).catch(() => ""),
  ])
  return parsePower(batt, therm, ioreg)
}
