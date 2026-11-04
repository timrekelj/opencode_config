import { spawn, execFile, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { homedir, platform } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Device, DeviceList, HubStatus, Platform } from "./types"

const READY_TIMEOUT_MS = 30_000
const READY_REQUEST_TIMEOUT_MS = 2_000
const API_TIMEOUT_MS = 60_000
const BOOT_TIMEOUT_MS = 180_000
/** How long a device listing is reused, so every window's poll shares one. */
const LIST_CACHE_MS = 1_000
const STATE_DIR = join(homedir(), ".cache", "opencode-devices")
const CLI = fileURLToPath(new URL("../node_modules/expo-device-hub/dist/server/cli.mjs", import.meta.url))

interface HubOptions {
  /** Node to run the hub with; the hub's native addons need Node, not Bun. */
  node?: string
  androidHome?: string
  javaHome?: string
  /** Extra hub CLI flags, e.g. `["--transport", "h264"]`. */
  args?: string[]
}

interface Environment {
  node: string
  env: NodeJS.ProcessEnv
  platforms: Platform[]
}

const run = (command: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<string>((resolve, reject) =>
    execFile(command, args, { env, timeout: 10_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))),
  )

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))))
    })
  })

/** The service's PATH is launchd's, so look where Node is usually installed, then ask a login shell. */
async function findNode(configured?: string) {
  if (configured) {
    if (existsSync(configured)) return configured
    throw new Error(`Node.js was not found at ${configured}. Fix "node" in the devices plugin options.`)
  }
  const candidates = [
    ...(process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "node")),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
  ]
  const found = candidates.find((file) => existsSync(file))
  if (found) return found
  const shell = await run(process.env.SHELL || "/bin/zsh", ["-lc", "command -v node"]).catch(() => "")
  if (shell && existsSync(shell)) return shell
  throw new Error('Node.js was not found. Set "node" in the devices plugin options to its path.')
}

function findAndroidHome(configured?: string) {
  return [configured, process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library", "Android", "sdk")]
    .filter((dir): dir is string => !!dir)
    .find((dir) => existsSync(join(dir, "platform-tools")))
}

/** avdmanager needs a JDK; Android Studio bundles one. */
function findJavaHome(configured?: string) {
  return [
    configured,
    process.env.JAVA_HOME,
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home",
  ]
    .filter((dir): dir is string => !!dir)
    .find((dir) => existsSync(join(dir, "bin", "java")))
}

async function hasXcode() {
  if (platform() !== "darwin") return false
  return run("/usr/bin/xcrun", ["--find", "simctl"]).then(
    () => true,
    () => false,
  )
}

async function detect(options: HubOptions): Promise<Environment> {
  if (!existsSync(CLI)) throw new Error(`expo-device-hub is not installed. Run "bun install" in ${dirname(dirname(CLI))}.`)
  const node = await findNode(options.node)
  const androidHome = findAndroidHome(options.androidHome)
  const javaHome = findJavaHome(options.javaHome)
  const platforms: Platform[] = []
  if (await hasXcode()) platforms.push("ios")
  if (androidHome) platforms.push("android")
  if (platforms.length === 0) throw new Error("Neither Xcode nor the Android SDK was found.")
  const path = [
    dirname(node),
    androidHome && join(androidHome, "platform-tools"),
    androidHome && join(androidHome, "emulator"),
    javaHome && join(javaHome, "bin"),
    process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  ]
    .filter(Boolean)
    .join(delimiter)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: path,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    ...(androidHome ? { ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome } : {}),
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  }
  return { node, env, platforms }
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Kills hubs an earlier server left behind, when their pid still runs the hub's CLI. */
async function reapStale() {
  if (!existsSync(STATE_DIR)) return
  for (const file of readdirSync(STATE_DIR).filter((name) => /^hub.*\.json$/.test(name))) {
    const path = join(STATE_DIR, file)
    try {
      const { pid } = JSON.parse(readFileSync(path, "utf8")) as { pid: number }
      if (pid && isAlive(pid)) {
        const command = await run("/bin/ps", ["-o", "command=", "-p", String(pid)]).catch(() => "")
        if (command.includes("expo-device-hub")) process.kill(pid, "SIGTERM")
      }
    } catch {}
    rmSync(path, { force: true })
  }
}

/** A child killed by a signal keeps `exitCode` null. */
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null

/** Polls the hub until it answers; `failed` reports a spawn error or a stop, which end the wait early. */
async function waitReady(origin: string, child: ChildProcess, failed: () => Error | undefined) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const error = failed()
    if (error) throw error
    if (exited(child)) throw new Error(`The device hub exited (${child.signalCode ?? `code ${child.exitCode}`}).`)
    const ok = await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(READY_REQUEST_TIMEOUT_MS) }).then(
      (response) => response.ok,
      () => false,
    )
    if (ok) return
    await sleep(250)
  }
  throw new Error("The device hub did not answer within 30 seconds.")
}

/** One expo-device-hub process on a free loopback port. */
class HubProcess {
  private child: ChildProcess | undefined
  private starting: Promise<void> | undefined
  private status: HubStatus = { state: "stopped", origin: null, error: null, platforms: [] }
  private output: string[] = []
  /** Bumped by stop(), so a start in progress notices it was cancelled. */
  private generation = 0
  /** When this hub was made, so a device listing that began earlier does not stop it. */
  readonly created = Date.now()

  constructor(
    private readonly name: string,
    private readonly environment: () => Promise<Environment>,
    private readonly args: string[],
  ) {}

  private get pidFile() {
    return join(STATE_DIR, `hub-${this.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`)
  }

  current(): HubStatus {
    return { ...this.status }
  }

  running() {
    return this.status.state === "running" && !!this.child && !exited(this.child)
  }

  async start(): Promise<HubStatus> {
    if (this.running()) return this.current()
    if (!this.starting) {
      const starting = this.spawn().finally(() => {
        if (this.starting === starting) this.starting = undefined
      })
      this.starting = starting
    }
    await this.starting.catch(() => {})
    return this.current()
  }

  /** The running hub's origin; throws with the hub's error when it cannot start. */
  async origin() {
    const status = await this.start()
    if (!status.origin) throw new Error(status.error ?? "The device hub is not running.")
    return status.origin
  }

  /** Kills the hub right away, also while it is still starting. */
  async stop() {
    this.generation++
    this.starting = undefined
    const child = this.child
    this.child = undefined
    this.status = { ...this.status, state: "stopped", origin: null }
    if (child && !exited(child)) {
      child.kill("SIGTERM")
      const done = new Promise((resolve) => child.once("exit", resolve))
      await Promise.race([done, sleep(3000)])
      if (!exited(child)) child.kill("SIGKILL")
    }
    rmSync(this.pidFile, { force: true })
  }

  private async spawn() {
    const generation = this.generation
    const cancelled = () => (this.generation === generation ? undefined : new Error("The device hub was stopped."))
    this.status = { state: "starting", origin: null, error: null, platforms: [] }
    this.output = []
    let spawned: ChildProcess | undefined
    try {
      const { node, env, platforms } = await this.environment()
      const port = await freePort()
      const stopped = cancelled()
      if (stopped) throw stopped
      const origin = `http://127.0.0.1:${port}`
      const child = spawn(node, [CLI, "--port", String(port), "--host", "127.0.0.1", ...this.args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      })
      spawned = child
      this.child = child
      // Without a listener, a spawn error (e.g. ENOENT for a bad node path) would crash the server.
      let spawnError: Error | undefined
      child.on("error", (error) => (spawnError ??= error))
      const keep = (chunk: Buffer) => {
        if (this.child !== child) return
        this.output.push(...chunk.toString().split("\n").filter(Boolean))
        this.output = this.output.slice(-40)
      }
      child.stdout?.on("data", keep)
      child.stderr?.on("data", keep)
      child.once("exit", (code, signal) => {
        if (this.child !== child) return
        this.child = undefined
        rmSync(this.pidFile, { force: true })
        this.status = {
          ...this.status,
          state: "failed",
          origin: null,
          error: `The device hub stopped (${signal ?? `code ${code}`}).\n${this.output.slice(-10).join("\n")}`,
        }
      })

      mkdirSync(STATE_DIR, { recursive: true })
      if (child.pid) writeFileSync(this.pidFile, JSON.stringify({ pid: child.pid, port }))
      await waitReady(origin, child, () => spawnError ?? cancelled())
      const late = cancelled()
      if (late) throw late
      this.status = { state: "running", origin, error: null, platforms }
    } catch (error) {
      if (spawned && !exited(spawned)) spawned.kill("SIGKILL")
      // A stop() since this start began owns the status now, and possibly a newer child.
      if (cancelled()) throw error
      const message = error instanceof Error ? error.message : String(error)
      const tail = this.output.slice(-10).join("\n")
      this.child = undefined
      rmSync(this.pidFile, { force: true })
      this.status = { state: "failed", origin: null, error: tail ? `${message}\n${tail}` : message, platforms: [] }
      throw error
    }
  }
}

const deviceKey = (platform: Platform, id: string) => `${platform}:${id}`

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** `com.apple.CoreSimulator.SimRuntime.iOS-27-0` → `iOS 27.0`; undefined for watchOS, tvOS and visionOS. */
const iosVersion = (runtime: string) => {
  const match = /SimRuntime\.iOS-(\d+)-(\d+)/.exec(runtime)
  return match ? `iOS ${match[1]}.${match[2]}` : undefined
}

async function listSimulators(env: NodeJS.ProcessEnv): Promise<Device[]> {
  const json = JSON.parse(await run("/usr/bin/xcrun", ["simctl", "list", "devices", "-j"], env)) as {
    devices: Record<string, { udid: string; name: string; state: string; isAvailable: boolean; availabilityError?: string }[]>
  }
  return Object.entries(json.devices).flatMap(([runtime, devices]) => {
    const version = iosVersion(runtime)
    if (!version) return []
    return devices.map((d) => ({
      id: d.udid,
      name: d.name,
      version,
      platform: "ios" as const,
      booted: d.state === "Booted",
      unavailable: d.isAvailable ? null : (d.availabilityError ?? "Unavailable"),
      key: `ios:${d.udid}`,
    }))
  })
}

/** `key=value` lines of an AVD's .ini files. */
const readIni = (file: string) => {
  const values: Record<string, string> = {}
  if (!existsSync(file)) return values
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=")
    if (i > 0) values[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return values
}

/**
 * AVDs from `emulator -list-avds`, joined with running emulators from `adb devices` by asking each emulator its AVD
 * name. A running emulator's id is its adb serial; a stopped one's is its AVD name. `complete` is false when adb could
 * not tell which emulators run, so the running ones may show as stopped; `error` says why adb failed.
 */
async function listEmulators(
  env: NodeJS.ProcessEnv,
): Promise<{ devices: Device[]; complete: boolean; error: string | undefined }> {
  const home = env.ANDROID_HOME!
  const adb = join(home, "platform-tools", "adb")
  let complete = true
  let error: string | undefined
  const [avds, adbDevices] = await Promise.all([
    run(join(home, "emulator", "emulator"), ["-list-avds"], env).then((out) => out.split("\n").map((l) => l.trim())),
    run(adb, ["devices"], env).catch((e) => {
      complete = false
      error = `adb devices failed: ${message(e)}`
      return ""
    }),
  ])
  const serials = adbDevices
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([serial, state]) => serial?.startsWith("emulator-") && state === "device")
    .map(([serial]) => serial)
  const running = new Map<string, string>()
  await Promise.all(
    serials.map(async (serial) => {
      const name = await run(adb, ["-s", serial, "emu", "avd", "name"], env).catch(() => "")
      const avd = name.split("\n")[0]?.trim()
      if (avd) running.set(avd, serial)
      else complete = false
    }),
  )
  const avdHome = env.ANDROID_AVD_HOME || join(homedir(), ".android", "avd")
  const devices = avds
    .filter((avd) => avd && !/^(INFO|WARNING|ERROR)\b/.test(avd))
    .map((avd) => {
      const pointer = readIni(join(avdHome, `${avd}.ini`))
      const config = readIni(join(pointer.path || join(avdHome, `${avd}.avd`), "config.ini"))
      const api = /android-(\d+(?:\.\d+)?)/.exec(config["image.sysdir.1"] ?? config.target ?? pointer.target ?? "")?.[1]
      const serial = running.get(avd)
      return {
        id: serial ?? avd,
        name: config["avd.ini.displayname"] || avd.replaceAll("_", " "),
        version: api ? `Android API ${api}` : "Android",
        platform: "android" as const,
        booted: !!serial,
        unavailable: null,
        key: `android:${avd}`,
      }
    })
  return { devices, complete, error }
}

/**
 * The hub that lists, boots and shuts down devices, plus one hub per opened device, locked to it with
 * `--single-device` so each device can show in its own tab. A device's hub stops when the device stops.
 */
export class Hubs {
  private environment: Promise<Environment> | undefined
  private reaped: Promise<void> | undefined
  private readonly main: HubProcess
  private readonly devices = new Map<string, HubProcess>()
  /** The listing in progress, shared by every caller, and the last one, reused for LIST_CACHE_MS. */
  private listing: Promise<DeviceList> | undefined
  private listed: { at: number; list: DeviceList } | undefined

  constructor(private readonly options: HubOptions) {
    this.main = new HubProcess("main", () => this.env(), options.args ?? [])
  }

  private async env() {
    this.reaped ??= reapStale()
    await this.reaped
    this.environment ??= detect(this.options).catch((error) => {
      this.environment = undefined
      throw error
    })
    return this.environment
  }

  async restart() {
    this.environment = undefined
    this.listed = undefined
    await this.stop()
    return this.main.start()
  }

  async stop() {
    const all = [this.main, ...this.devices.values()]
    this.devices.clear()
    await Promise.all(all.map((hub) => hub.stop()))
  }

  private async api<T>(path: string, body?: object): Promise<T> {
    const origin = await this.main.origin()
    const response = await fetch(`${origin}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: { message: string }[] }
    if (!response.ok || json.ok === false) {
      throw new Error(json.error ?? json.errors?.map((e) => e.message).join("\n") ?? `${path}: ${response.status}`)
    }
    return json as T
  }

  /**
   * Every installed simulator and emulator. Listed here rather than by the hub: the hub leaves out devices that were
   * never booted and simulators whose runtime is missing, and this page should show them all.
   */
  list(): Promise<DeviceList> {
    if (this.listed && Date.now() - this.listed.at < LIST_CACHE_MS) return Promise.resolve(this.listed.list)
    if (!this.listing) {
      const listing = this.listDevices()
        .then((list) => {
          if (this.listing === listing) this.listed = { at: Date.now(), list }
          return list
        })
        .finally(() => {
          if (this.listing === listing) this.listing = undefined
        })
      this.listing = listing
    }
    return this.listing
  }

  /** Drops the cached listing after a boot or shutdown, so the next list sees it. */
  private invalidate() {
    this.listing = undefined
    this.listed = undefined
  }

  private async listDevices(): Promise<DeviceList> {
    const started = Date.now()
    const { platforms, env } = await this.env()
    const errors: string[] = []
    // Platforms whose running devices are known; a failed listing says nothing about which devices stopped.
    const known = new Set<Platform>()
    const [ios, android] = await Promise.all([
      platforms.includes("ios")
        ? listSimulators(env).then(
            (devices) => (known.add("ios"), devices),
            (e) => (errors.push(`iOS: ${message(e)}`), []),
          )
        : [],
      platforms.includes("android")
        ? listEmulators(env).then(
            (result) => {
              if (result.complete) known.add("android")
              if (result.error) errors.push(`Android: ${result.error}`)
              return result.devices
            },
            (e) => (errors.push(`Android: ${message(e)}`), []),
          )
        : [],
    ])
    const devices = [...ios, ...android]
    // Stop the hubs of devices that are no longer running, but not ones opened after this listing began.
    const running = new Set(devices.filter((d) => d.booted).map((d) => deviceKey(d.platform, d.id)))
    for (const [key, hub] of this.devices) {
      const platform = key.slice(0, key.indexOf(":")) as Platform
      if (!known.has(platform) || hub.created >= started || running.has(key)) continue
      this.devices.delete(key)
      void hub.stop()
    }
    return { devices, errors, platforms }
  }

  private async find(input: { platform: Platform; id: string }) {
    const { devices } = await this.list()
    const device = devices.find((d) => d.platform === input.platform && d.id === input.id)
    if (!device) throw new Error("The device is no longer installed.")
    return device
  }

  /** The device as the hub's boot and shutdown routes name it: a stopped emulator by its AVD name. */
  private action(device: Device) {
    const avd = device.key.slice("android:".length)
    return device.platform === "android"
      ? { platform: device.platform, id: device.booted ? device.id : avd, name: avd }
      : { platform: device.platform, id: device.id, name: device.name }
  }

  /** Boots a device and waits until it runs; returns it. */
  async boot(input: { platform: Platform; id: string }): Promise<Device> {
    const device = await this.find(input)
    if (device.booted) return device
    if (device.unavailable) throw new Error(device.unavailable)
    await this.api("/api/devices/boot", this.action(device))
    this.invalidate()
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const { devices } = await this.list()
      const booted = devices.find((d) => d.key === device.key && d.booted)
      if (booted) return booted
      await sleep(1500)
    }
    throw new Error(`${device.name} did not start within ${BOOT_TIMEOUT_MS / 1000} seconds.`)
  }

  async shutdown(input: { platform: Platform; id: string }) {
    const key = deviceKey(input.platform, input.id)
    const hub = this.devices.get(key)
    this.devices.delete(key)
    await hub?.stop()
    const device = await this.find(input)
    if (device.booted) {
      await this.api("/api/devices/shutdown", this.action(device))
      this.invalidate()
    }
    return null
  }

  /** The origin of a hub locked to one running device, started on first use. */
  async open(input: { platform: Platform; id: string }): Promise<HubStatus> {
    const device = await this.find(input)
    if (!device.booted) throw new Error(`${device.name} isn't running.`)
    const key = deviceKey(input.platform, input.id)
    let hub = this.devices.get(key)
    if (!hub) {
      hub = new HubProcess(key, () => this.env(), [
        "--platform",
        input.platform,
        "--single-device",
        input.id,
        "--hide-sidebar",
        ...(this.options.args ?? []),
      ])
      this.devices.set(key, hub)
    }
    const status = await hub.start()
    if (status.state === "failed") {
      if (this.devices.get(key) === hub) this.devices.delete(key)
      throw new Error(status.error ?? "The device hub failed to start.")
    }
    return status
  }
}
