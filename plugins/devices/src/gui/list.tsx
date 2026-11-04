import { usePanel } from "@opencode/plugin/gui"
import { createEffect, createMemo, For, Match, onCleanup, Show, Switch } from "solid-js"
import type { Device, Platform } from "../types"
import { PhoneIcon } from "./phone"
import { platformLabel, type App } from "./state"

const POLL_MS = 4000

/** Refreshes the device list while the calling tab is on screen. */
export function usePolling(app: App) {
  const panel = usePanel()
  createEffect(() => {
    if (!panel.visible()) return
    void app.refresh()
    const timer = setInterval(() => void app.refresh(), POLL_MS)
    onCleanup(() => clearInterval(timer))
  })
}

const PLATFORMS: Platform[] = ["ios", "android"]

const sorted = (devices: readonly Device[], platform: Platform) =>
  devices
    .filter((d) => d.platform === platform)
    .sort(
      (a, b) =>
        Number(b.booted) - Number(a.booted) ||
        Number(!!a.unavailable) - Number(!!b.unavailable) ||
        a.name.localeCompare(b.name),
    )

/** Every simulator and emulator, with Open for running ones and Start for stopped ones, as T3 Code's Device panel. */
export function DeviceList(props: { app: App }) {
  const { app } = props
  const ui = app.ctx.ui
  usePolling(app)

  return (
    <div class="dev-root">
      <div class="dev-toolbar">
        <span class="dev-title">Devices</span>
        <span class="dev-spacer" />
        <ui.IconButton icon="refresh" label="Refresh devices" size="small" onClick={() => void app.refresh()} />
      </div>
      <Show when={app.state.notice}>
        {(notice) => (
          <div class="dev-notice" role="alert">
            <ui.Icon name="circle-exclamation" size="small" />
            <div class="dev-notice-text">{notice()}</div>
            <ui.IconButton icon="close-small" label="Dismiss" size="small" onClick={app.dismissNotice} />
          </div>
        )}
      </Show>
      <div class="dev-scroll">
        <Switch>
          <Match when={!app.state.loaded}>
            <div class="dev-message dev-muted">Finding devices…</div>
          </Match>
          <Match when={app.state.error}>
            {(error) => (
              <div class="dev-message">
                <ui.Icon name="warning" />
                <div>The device hub isn't running.</div>
                <pre class="dev-error">{error()}</pre>
                <ui.Button busy={app.restarting()} onClick={() => void app.restart()}>
                  Restart
                </ui.Button>
              </div>
            )}
          </Match>
          <Match when={app.state.devices.length === 0}>
            <div class="dev-message dev-muted">
              <PhoneIcon class="dev-empty-icon" />
              <div>No simulators or emulators were found.</div>
            </div>
          </Match>
          <Match when={true}>
            <div class="dev-sections">
              <For each={PLATFORMS}>
                {(platform) => {
                  const devices = createMemo(() => sorted(app.state.devices, platform))
                  return (
                    <Show when={devices().length > 0}>
                      <section class="dev-section">
                        <h3 class="dev-section-title">
                          <PhoneIcon class="dev-section-icon" />
                          {platformLabel(platform)}
                        </h3>
                        <div class="dev-list">
                          <For each={devices()}>{(device) => <DeviceRow app={app} device={device} />}</For>
                        </div>
                      </section>
                    </Show>
                  )
                }}
              </For>
              <Show when={app.state.platforms.includes("android") && !app.state.devices.some((d) => d.platform === "android")}>
                <p class="dev-hint">
                  No Android virtual devices found. Create one in Android Studio's Device Manager, then refresh.
                </p>
              </Show>
              <Show when={app.state.devices.some((d) => d.unavailable && !d.booted)}>
                <p class="dev-hint">
                  Unavailable simulators can't load their iOS runtime ("
                  {app.state.devices.find((d) => d.unavailable)?.unavailable}"). This usually happens after an Xcode
                  update; opening Xcode once, or restarting the Mac, reloads the runtimes.
                </p>
              </Show>
              <Show when={app.state.errors.length > 0}>
                <details class="dev-hint">
                  <summary>Device discovery warnings ({app.state.errors.length})</summary>
                  <pre class="dev-error">{app.state.errors.join("\n")}</pre>
                </details>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function DeviceRow(props: { app: App; device: Device }) {
  const { app } = props
  const ui = app.ctx.ui
  const pending = () => app.state.pending[props.device.key]
  const status = () =>
    pending() === "starting"
      ? "Starting…"
      : pending() === "stopping"
        ? "Stopping…"
        : props.device.booted
          ? "Running"
          : props.device.unavailable
            ? "Unavailable"
            : "Stopped"
  const unavailable = () => !props.device.booted && !!props.device.unavailable

  return (
    <div
      class="dev-row"
      classList={{ "dev-row-busy": !!pending(), "dev-row-unavailable": unavailable() }}
      role={unavailable() ? undefined : "button"}
      tabIndex={unavailable() ? undefined : 0}
      title={
        props.device.booted
          ? `Open ${props.device.name}`
          : (props.device.unavailable ?? `Start ${props.device.name}`)
      }
      onClick={() => !unavailable() && void app.start(props.device)}
      onKeyDown={(event) => {
        if (!unavailable() && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          void app.start(props.device)
        }
      }}
    >
      <span class="dev-row-icon">
        <PhoneIcon />
      </span>
      <div class="dev-row-text">
        <span class="dev-row-name dev-ellipsis">{props.device.name}</span>
        <span class="dev-row-detail dev-ellipsis">
          <span class={`dev-dot ${props.device.booted ? "dev-dot-running" : ""} ${pending() ? "dev-dot-starting" : ""}`} />
          {[props.device.version, status()].filter(Boolean).join(" · ")}
        </span>
      </div>
      <Show when={!unavailable()}>
        <div class="dev-row-actions" onClick={(event) => event.stopPropagation()}>
          <Show when={props.device.booted && !pending()}>
            <ui.IconButton icon="stop" label={`Stop ${props.device.name}`} size="small" onClick={() => void app.stop(props.device)} />
          </Show>
          <ui.Button
            size="small"
            icon={props.device.booted ? "square-arrow-top-right" : undefined}
            busy={!!pending()}
            onClick={() => void app.start(props.device)}
          >
            {props.device.booted ? "Open" : "Start"}
          </ui.Button>
        </div>
      </Show>
    </div>
  )
}
