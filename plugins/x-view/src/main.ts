import type { MainContext } from "@opencode/plugin/gui/main"
import { session, shell, WebContentsView, type WebContents } from "electron"
import { XView } from "./contract"

const DEFAULT_URL = "https://x.com/home"

/** On disk, so cookies (the X login) survive restarts. Kept apart from the agent's browser pane. */
const PARTITION = "persist:x-view"

const X_HOSTS = ["x.com", "twitter.com"]
/** Sign in with Google or Apple opens these in a popup; a redirect flow can also pass through them. */
const AUTH_HOSTS = ["accounts.google.com", "appleid.apple.com", "idmsa.apple.com"]

const host = (url: string) => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" ? parsed.hostname : undefined
  } catch {
    return undefined
  }
}
const within = (url: string, hosts: string[]) => {
  const name = host(url)
  return !!name && hosts.some((h) => name === h || name.endsWith(`.${h}`))
}
const isX = (url: string) => within(url, X_HOSTS)
const isAuth = (url: string) => within(url, AUTH_HOSTS)

/**
 * Electron's user agent names Electron and the app, and Google refuses to sign in "insecure" embedded browsers it
 * recognizes that way. Keep only the tokens Chrome itself sends.
 */
const chromeUserAgent = (ua: string) => ua.replace(/\s(?!(?:AppleWebKit|Chrome|Safari|Mobile)\/)[\w.-]+\/\S+/g, "")

interface View {
  view: WebContentsView
  embed: { id: string; dispose(): void }
}

/** One view per window. Navigation stays on X (and its sign-in providers); other links open in the default browser. */
export function main(ctx: MainContext) {
  const start = (() => {
    const option = typeof ctx.options.url === "string" ? ctx.options.url.trim() : ""
    return isX(option) ? option : DEFAULT_URL
  })()

  const partition = session.fromPartition(PARTITION)
  partition.setUserAgent(chromeUserAgent(partition.getUserAgent()))

  const views = new Map<number, View>()

  const provider = ctx.provide(XView, {
    state: (window) => {
      const contents = typeof window === "number" ? live(window) : undefined
      if (!contents) return { url: "", loading: false, canGoBack: false, canGoForward: false }
      return {
        url: contents.getURL(),
        loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
      }
    },
    open: ({ background }, caller) => {
      const entry = views.get(caller.window) ?? create(caller.window)
      try {
        entry.view.setBackgroundColor(background)
      } catch {}
      return entry.embed.id
    },
    back: (_input, caller) => {
      const contents = live(caller.window)
      if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    },
    forward: (_input, caller) => {
      const contents = live(caller.window)
      if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    },
    reload: (_input, caller) => live(caller.window)?.reload(),
    home: (_input, caller) => void live(caller.window)?.loadURL(start).catch(() => {}),
    devtools: (_input, caller) => live(caller.window)?.openDevTools({ mode: "detach" }),
    close: (_input, caller) => dispose(caller.window),
  })

  const live = (window: number) => {
    const contents = views.get(window)?.view.webContents
    return contents && !contents.isDestroyed() ? contents : undefined
  }

  /** Links leave for the default browser; sign-in popups open in a small window that shares the partition. */
  const guard = (contents: WebContents, allow: (url: string) => boolean) => {
    contents.on("will-navigate", (event, url) => {
      if (allow(url)) return
      event.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (isAuth(url)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            autoHideMenuBar: true,
            webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        }
      }
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
    contents.on("did-create-window", (popup) => guard(popup.webContents, (url) => isAuth(url) || isX(url)))
  }

  const create = (windowId: number) => {
    const window = ctx.windows.get(windowId)
    if (!window) throw new Error("The window is gone.")
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        devTools: true,
      },
    })
    const contents = view.webContents
    guard(contents, (url) => isX(url) || isAuth(url))
    const changed = () => provider.changed(windowId)
    contents.on("did-start-loading", changed)
    contents.on("did-stop-loading", changed)
    contents.on("did-navigate", changed)
    contents.on("did-navigate-in-page", changed)
    const embed = ctx.embeds.create(view, window)
    embed.show(true)
    const entry: View = { view, embed }
    views.set(windowId, entry)
    void contents.loadURL(start).catch(() => {})
    return entry
  }

  const dispose = (windowId: number) => {
    const entry = views.get(windowId)
    if (!entry) return
    views.delete(windowId)
    entry.embed.dispose()
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    provider.changed(windowId)
  }

  ctx.windows.on("close", (window) => dispose(window.id))
  ctx.onCleanup(() => {
    for (const windowId of [...views.keys()]) dispose(windowId)
  })
}
