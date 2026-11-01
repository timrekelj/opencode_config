import type { Plugin } from "@opencode/plugin/gui"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Hub } from "../rpc"
import type { Device, DeviceList, HubStatus, Platform } from "../types"

export type Ctx = Parameters<Plugin.Setup>[0]

export const LIST_TAB = "devices"
export const DEVICE_PREFIX = "device:"

export const deviceTabId = (key: string) => `${DEVICE_PREFIX}${key}`
export const deviceTabKey = (id: string) => (id.startsWith(DEVICE_PREFIX) ? id.slice(DEVICE_PREFIX.length) : undefined)

/** A readable name before the list loads: the AVD name of `android:<avd>`, else the key. */
export const fallbackName = (key: string) =>
  key.startsWith("android:") ? key.slice("android:".length).replaceAll("_", " ") : key.split(":").slice(1).join(":")

export const platformLabel = (platform: Platform) => (platform === "ios" ? "iOS Simulators" : "Android Emulators")

interface Rpc {
  start(input: object): Promise<HubStatus>
  status(input: object): Promise<HubStatus>
  restart(input: object): Promise<HubStatus>
  list(input: object): Promise<DeviceList>
  boot(input: { platform: Platform; id: string }): Promise<Device>
  shutdown(input: { platform: Platform; id: string }): Promise<null>
  open(input: { platform: Platform; id: string }): Promise<HubStatus>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export type App = ReturnType<typeof makeApp>

/** The device list every tab reads, and the actions on it. */
export function makeApp(ctx: Ctx) {
  const rpc = () => ctx.client.rpc(Hub) as unknown as Rpc
  const [state, setState] = createStore({
    loaded: false,
    devices: [] as Device[],
    errors: [] as string[],
    platforms: [] as Platform[],
    /** Why the last list failed: the hub did not start, or it did not answer. */
    error: null as string | null,
    /** Starting or stopping devices, by key. */
    pending: {} as Record<string, "starting" | "stopping" | undefined>,
    /** The last failed action, shown above the list until dismissed. */
    notice: null as string | null,
  })
  const [restarting, setRestarting] = createSignal(false)

  let inflight: Promise<void> | undefined
  const refresh = () =>
    (inflight ??= rpc()
      .list({})
      .then(
        (list) => setState({ loaded: true, devices: list.devices, errors: list.errors, platforms: list.platforms, error: null }),
        (error) => setState({ loaded: true, error: message(error) }),
      )
      .finally(() => (inflight = undefined)))

  const device = (key: string) => state.devices.find((d) => d.key === key)

  const openTab = (key: string) => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.open(`${ctx.id}:${deviceTabId(key)}`, session, { tab: "select" })
  }

  const openList = () => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.open(`${ctx.id}:${LIST_TAB}`, session, { tab: "select" })
  }

  /** Boots the device if it is stopped, then opens its tab. */
  const start = async (target: Device, open = true) => {
    if (state.pending[target.key]) return
    if (target.booted) return open ? openTab(target.key) : undefined
    if (target.unavailable) return setState("notice", `${target.name} can't start: ${target.unavailable}`)
    setState("pending", target.key, "starting")
    try {
      await rpc().boot({ platform: target.platform, id: target.id })
      await refresh()
      if (open) openTab(target.key)
    } catch (error) {
      setState("notice", `Couldn't start ${target.name}: ${message(error)}`)
    } finally {
      setState("pending", target.key, undefined)
    }
  }

  const stop = async (target: Device) => {
    if (state.pending[target.key]) return
    setState("pending", target.key, "stopping")
    try {
      await rpc().shutdown({ platform: target.platform, id: target.id })
      await refresh()
    } catch (error) {
      setState("notice", `Couldn't stop ${target.name}: ${message(error)}`)
    } finally {
      setState("pending", target.key, undefined)
    }
  }

  const restart = async () => {
    setRestarting(true)
    try {
      await rpc().restart({})
    } catch {}
    setRestarting(false)
    await refresh()
  }

  return {
    ctx,
    state,
    rpc,
    refresh,
    device,
    openTab,
    openList,
    start,
    stop,
    restart,
    restarting,
    dismissNotice: () => setState("notice", null),
    message,
  }
}
