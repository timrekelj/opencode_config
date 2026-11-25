import os from "node:os"
import type { HostInfo } from "../types"
import { run } from "./exec"

let static_: Promise<Pick<HostInfo, "model" | "chip" | "osVersion">> | undefined

const sysctl = (key: string) => run("sysctl", ["-n", key]).then((s) => s.trim() || undefined, () => undefined)

const staticInfo = () =>
  (static_ ??= Promise.all([sysctl("hw.model"), sysctl("machdep.cpu.brand_string"), run("sw_vers", ["-productVersion"]).then((s) => s.trim(), () => os.release())]).then(
    ([model, chip, version]) => ({ model, chip, osVersion: `macOS ${version}` }),
  ))

export async function collectHost(): Promise<HostInfo> {
  return { hostname: os.hostname(), uptime: os.uptime(), cores: os.cpus().length, ...(await staticInfo()) }
}
