import type { MainContext } from "@opencode/plugin/gui/main"
import { shell, WebContentsView } from "electron"
import { DeviceView } from "./contract"

interface Theme {
  background: string
  border: string
}

interface View {
  view: WebContentsView
  embed: { id: string; dispose(): void }
  url: string
  theme: Theme | undefined
  /** The key `insertCSS` returned, to replace the style when the theme changes. */
  css: string | undefined
}

/**
 * Restyles the hub's single-device page to sit inside the panel: the panel's background, no device name pill (the tab
 * toolbar shows it), no floating sidebar toggle (the tab toolbar's Inspector button clicks it), and a smaller, flatter
 * control bar. The hub's markup comes from react-native-web, so these hang on its test ids and ARIA labels.
 */
const hubCss = (theme: Theme) => `
html, body, #root, #root > div, #root section { background: ${theme.background} !important; }
[data-testid="device-frame-anchor"] > div:not([role]):has(> button) { display: none !important; }
[data-floating-sidebar-toggle] { display: none !important; }
[role="toolbar"][aria-label="Device controls"] { zoom: 0.72; }
[role="toolbar"][aria-label="Device controls"] > * {
  background: transparent !important;
  border-color: ${theme.border} !important;
  border-radius: 10px !important;
  box-shadow: none !important;
}
`

/**
 * One view per window and device tab. Navigation stays on the device hub's origin; other links open in the default
 * browser.
 */
export function main(ctx: MainContext) {
  const views = new Map<string, View>()
  const id = (window: number, key: string) => `${window}\u0000${key}`

  const style = async (entry: View) => {
    const contents = entry.view.webContents
    if (!entry.theme || contents.isDestroyed()) return
    const previous = entry.css
    entry.css = await contents.insertCSS(hubCss(entry.theme)).catch(() => undefined)
    if (previous) await contents.removeInsertedCSS(previous).catch(() => {})
  }

  const create = (windowId: number, key: string) => {
    const window = ctx.windows.get(windowId)
    if (!window) throw new Error("The window is gone.")
    const view = new WebContentsView({
      webPreferences: {
        partition: "persist:opencode-devices",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        devTools: true,
        backgroundThrottling: false,
      },
    })
    const contents = view.webContents
    const sameOrigin = (url: string) => {
      const current = views.get(id(windowId, key))?.url
      try {
        return !!current && new URL(url).origin === new URL(current).origin
      } catch {
        return false
      }
    }
    contents.on("will-navigate", (event, url) => {
      if (sameOrigin(url)) return
      event.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
    const embed = ctx.embeds.create(view, window)
    embed.show(true)
    const entry: View = { view, embed, url: "", theme: undefined, css: undefined }
    // Each load drops inserted styles, reloads included.
    contents.on("dom-ready", () => {
      entry.css = undefined
      void style(entry)
    })
    views.set(id(windowId, key), entry)
    return entry
  }

  const dispose = (viewId: string) => {
    const entry = views.get(viewId)
    if (!entry) return
    views.delete(viewId)
    entry.embed.dispose()
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }

  ctx.windows.on("close", (window) => {
    for (const viewId of [...views.keys()]) if (viewId.startsWith(`${window.id}\u0000`)) dispose(viewId)
  })
  ctx.onCleanup(() => {
    for (const viewId of [...views.keys()]) dispose(viewId)
  })

  ctx.provide(DeviceView, {
    open: async ({ key, url, theme }, caller) => {
      const entry = views.get(id(caller.window, key)) ?? create(caller.window, key)
      if (theme && (entry.theme?.background !== theme.background || entry.theme?.border !== theme.border)) {
        entry.theme = theme
        try {
          entry.view.setBackgroundColor(theme.background)
        } catch {}
        void style(entry)
      }
      if (entry.url !== url) {
        entry.url = url
        await entry.view.webContents.loadURL(url).catch(() => {})
      }
      return entry.embed.id
    },
    reload: ({ key }, caller) => {
      views.get(id(caller.window, key))?.view.webContents.reload()
    },
    devtools: ({ key }, caller) => {
      views.get(id(caller.window, key))?.view.webContents.openDevTools({ mode: "detach" })
    },
    inspector: async ({ key }, caller) => {
      const contents = views.get(id(caller.window, key))?.view.webContents
      if (contents && !contents.isDestroyed()) {
        await contents.executeJavaScript(`document.querySelector('[aria-label="Toggle sidebar"]')?.click()`).catch(() => {})
      }
    },
    close: ({ key }, caller) => dispose(id(caller.window, key)),
  })
}
