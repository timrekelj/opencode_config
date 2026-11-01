export type Platform = "ios" | "android"

export interface HubStatus {
  /** `stopped` until something opens the panel. */
  state: "stopped" | "starting" | "running" | "failed"
  /** The hub's loopback origin while it runs, e.g. `http://127.0.0.1:3400`. */
  origin: string | null
  /** Why the last start failed. */
  error: string | null
  /** Platforms the hub can show: `ios` needs Xcode, `android` the Android SDK. */
  platforms: string[]
}

export interface Device {
  /** Simulator UDID, or the adb serial of a running emulator (its AVD name while stopped). */
  id: string
  name: string
  /** e.g. `iOS 27.0`. */
  version: string
  platform: Platform
  booted: boolean
  /** Why the device cannot start, e.g. its iOS runtime is missing. */
  unavailable: string | null
  /** Stays the same while the device starts and stops: `ios:<udid>` or `android:<avd name>`. */
  key: string
}

export interface DeviceList {
  devices: Device[]
  errors: string[]
  platforms: Platform[]
}
