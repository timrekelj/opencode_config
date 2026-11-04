import { usePanel } from "@opencode/plugin/gui"
import { createEffect, createSignal, Match, on, Switch } from "solid-js"
import { DeviceView } from "../contract"
import { usePolling } from "./list"
import { fallbackName, type App } from "./state"

const transparent = (color: string) => !color || color === "transparent" || color === "rgba(0, 0, 0, 0)"

/** The background the panel paints (the nearest opaque ancestor's) and its toolbar's border color. */
function panelTheme(root: HTMLElement, toolbar: HTMLElement) {
  let background = ""
  for (let node: HTMLElement | null = root; node && transparent(background); node = node.parentElement) {
    background = getComputedStyle(node).backgroundColor
  }
  return {
    background: transparent(background) ? "rgb(22, 22, 24)" : background,
    border: getComputedStyle(toolbar).borderBottomColor,
  }
}

/** One device's live screen, from a hub locked to that device. */
export function DeviceTab(props: { app: App; deviceKey: string }) {
  const { app } = props
  const { ctx } = app
  const ui = ctx.ui
  const panel = usePanel()
  const view = ctx.main(DeviceView)
  usePolling(app)

  const device = () => app.device(props.deviceKey)
  const pending = () => app.state.pending[props.deviceKey]
  const [origin, setOrigin] = createSignal<string>()
  const [embed, setEmbed] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  // The device the hub was last asked for, so a late answer for an older one is dropped.
  let opening: string | undefined

  // Start the device's hub whenever the device runs under a new id (an emulator gets a new serial on each boot).
  createEffect(
    on(
      () => {
        const d = device()
        return d?.booted ? `${d.platform}\u0000${d.id}` : undefined
      },
      (target) => {
        opening = target
        setOrigin(undefined)
        setEmbed(undefined)
        setError(undefined)
        const d = device()
        if (!target || !d) return
        app
          .rpc()
          .open({ platform: d.platform, id: d.id })
          .then(
            (status) => {
              if (opening !== target) return
              if (status.origin) setOrigin(status.origin)
              else setError(status.error ?? "The device hub did not start.")
            },
            (e) => opening === target && setError(app.message(e)),
          )
      },
    ),
  )

  let root: HTMLDivElement | undefined
  let toolbar: HTMLDivElement | undefined

  // Load the device page, and pass the panel's colors again each time the tab shows, so a theme switch reaches it.
  createEffect(
    on([origin, panel.visible], ([url, visible]) => {
      if (!url || !visible || !root || !toolbar) return
      const current = () => origin() === url
      view.open({ key: props.deviceKey, url: `${url}/`, theme: panelTheme(root, toolbar) }).then(
        (id) => current() && setEmbed(id),
        (e) => current() && setError(app.message(e)),
      )
    }),
  )

  const name = () => device()?.name ?? fallbackName(props.deviceKey)

  const powerOff = async () => {
    const d = device()
    if (!d) return
    await app.stop(d)
    view.close({ key: props.deviceKey }).catch(() => {})
  }

  return (
    <div class="dev-root" ref={root}>
      <div class="dev-toolbar" ref={toolbar}>
        <span class={`dev-dot ${device()?.booted ? "dev-dot-running" : ""} ${pending() ? "dev-dot-starting" : ""}`} />
        <span class="dev-title dev-ellipsis">{name()}</span>
        <span class="dev-muted dev-ellipsis">{device()?.version}</span>
        <span class="dev-spacer" />
        <ui.IconButton icon="bullet-list" label="All devices" size="small" onClick={app.openList} />
        <ui.IconButton
          icon="sliders"
          label="Inspector"
          size="small"
          disabled={!embed()}
          onClick={() => void view.inspector({ key: props.deviceKey })}
        />
        <ui.IconButton
          icon="refresh"
          label="Reload"
          size="small"
          disabled={!embed()}
          onClick={() => void view.reload({ key: props.deviceKey })}
        />
        <ui.IconButton
          icon="stop"
          label="Power off"
          size="small"
          disabled={!device()?.booted}
          busy={pending() === "stopping"}
          onClick={() => void powerOff()}
        />
        <ui.IconButton
          icon="square-arrow-top-right"
          label="Open in browser"
          size="small"
          disabled={!origin()}
          onClick={() => origin() && ctx.system.openExternal(origin()!)}
        />
        <ui.IconButton
          icon="code"
          label="DevTools"
          size="small"
          disabled={!embed()}
          onClick={() => void view.devtools({ key: props.deviceKey })}
        />
      </div>
      <Switch>
        <Match when={!app.state.loaded}>
          <div class="dev-message dev-muted">Finding {name()}…</div>
        </Match>
        <Match when={!device()}>
          <div class="dev-message">
            <ui.Icon name="warning" />
            <div>{name()} isn't installed on this machine anymore.</div>
            <ui.Button onClick={app.openList}>All devices</ui.Button>
          </div>
        </Match>
        <Match when={pending() === "starting"}>
          <div class="dev-message dev-muted">Starting {name()}… This can take a minute.</div>
        </Match>
        <Match when={!device()!.booted}>
          <div class="dev-message">
            <div>{name()} isn't running.</div>
            <ui.Button variant="contrast" busy={!!pending()} onClick={() => void app.start(device()!, false)}>
              Start
            </ui.Button>
          </div>
        </Match>
        <Match when={error()}>
          <div class="dev-message">
            <ui.Icon name="warning" />
            <div>Couldn't open {name()}.</div>
            <pre class="dev-error">{error()}</pre>
          </div>
        </Match>
        <Match when={!embed()}>
          <div class="dev-message dev-muted">Opening {name()}…</div>
        </Match>
        <Match when={embed()}>
          {(id) => <ctx.embeds.View id={id()} visible={panel.visible()} page={origin()} class="dev-embed" />}
        </Match>
      </Switch>
    </div>
  )
}
