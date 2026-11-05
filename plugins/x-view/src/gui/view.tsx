import { usePanel, type Plugin } from "@opencode/plugin/gui"
import { createEffect, createSignal, Match, on, Switch } from "solid-js"
import { XView } from "../contract"

type Ctx = Parameters<Plugin.Setup>[0]

const transparent = (color: string) => !color || color === "transparent" || color === "rgba(0, 0, 0, 0)"

/** The background the panel paints: the nearest opaque ancestor's. */
function panelBackground(root: HTMLElement) {
  let background = ""
  for (let node: HTMLElement | null = root; node && transparent(background); node = node.parentElement) {
    background = getComputedStyle(node).backgroundColor
  }
  return transparent(background) ? "rgb(22, 22, 24)" : background
}

export function XLogo() {
  return (
    <svg class="xv-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  )
}

/** X in an embedded view that main keeps per window, logged in across restarts. */
export function XTab(props: { ctx: Ctx }) {
  const { ctx } = props
  const ui = ctx.ui
  const panel = usePanel()
  const view = ctx.main(XView)
  const page = () => view.state()
  const [embed, setEmbed] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  let root: HTMLDivElement | undefined

  // Create the view the first time the tab shows, and pass the panel's background each time, so a theme switch
  // reaches it.
  createEffect(
    on(panel.visible, (visible) => {
      if (!visible || !root) return
      view.open({ background: panelBackground(root) }).then(setEmbed, (e) => setError(e instanceof Error ? e.message : String(e)))
    }),
  )

  return (
    <div class="xv-root" ref={root}>
      <div class="xv-toolbar">
        <ui.IconButton
          icon="arrow-left"
          label="Back"
          size="small"
          disabled={!page()?.canGoBack}
          onClick={() => void view.back()}
        />
        <ui.IconButton
          icon="arrow-right"
          label="Forward"
          size="small"
          disabled={!page()?.canGoForward}
          onClick={() => void view.forward()}
        />
        <ui.IconButton
          icon="refresh"
          label="Reload"
          size="small"
          disabled={!embed()}
          busy={!!page()?.loading}
          onClick={() => void view.reload()}
        />
        <button class="xv-url xv-ellipsis" title="Go to start page" disabled={!embed()} onClick={() => void view.home()}>
          {page()?.url.replace(/^https:\/\/(www\.)?/, "") || "x.com"}
        </button>
        <ui.IconButton
          icon="square-arrow-top-right"
          label="Open in browser"
          size="small"
          disabled={!page()?.url}
          onClick={() => page()?.url && ctx.system.openExternal(page()!.url)}
        />
        <ui.IconButton
          icon="code"
          label="DevTools"
          size="small"
          disabled={!embed()}
          onClick={() => void view.devtools()}
        />
      </div>
      <Switch>
        <Match when={ctx.app.platform !== "desktop"}>
          <div class="xv-message xv-muted">X needs OpenCode Desktop.</div>
        </Match>
        <Match when={error()}>
          <div class="xv-message">
            <ui.Icon name="warning" />
            <div>Couldn't open X.</div>
            <pre class="xv-error">{error()}</pre>
          </div>
        </Match>
        <Match when={!embed()}>
          <div class="xv-message">
            <ui.Loader />
          </div>
        </Match>
        <Match when={embed()}>
          {(id) => <ctx.embeds.View id={id()} visible={panel.visible()} page={page()?.url} class="xv-embed" />}
        </Match>
      </Switch>
    </div>
  )
}
