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

/**
 * Sets the page's lock. While locked, a gray overlay with a lock covers the page and takes the clicks, and capture
 * listeners drop wheel and trackpad scrolling and the keys that scroll or move through the timeline (outside text
 * fields). The overlay hangs off <html>, outside the tree X's app renders into. A full load runs it again; X's in-app
 * navigation keeps the listeners and the overlay.
 */
const lockScript = (locked: boolean) => `(() => {
  window.__xvLocked = ${locked}
  const existing = document.getElementById("__xv-lock")
  if (!${locked}) existing?.remove()
  else if (!existing) {
    const overlay = document.createElement("div")
    overlay.id = "__xv-lock"
    overlay.style.cssText = [
      "position: fixed", "inset: 0", "z-index: 2147483647",
      "display: flex", "flex-direction: column", "align-items: center", "justify-content: center", "gap: 12px",
      "background: rgba(40, 40, 44, 0.55)", "backdrop-filter: grayscale(1) blur(3px)",
      "color: rgba(255, 255, 255, 0.85)", "font: 500 14px -apple-system, BlinkMacSystemFont, sans-serif",
      "cursor: default", "user-select: none",
    ].join(";")
    // DOM calls rather than innerHTML, which x.com's Trusted Types policy may refuse.
    const svg = (tag, attrs) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag)
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
      return node
    }
    const icon = svg("svg", {
      width: "40", height: "40", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round",
    })
    icon.append(svg("rect", { x: "4", y: "11", width: "16", height: "10", rx: "2" }), svg("path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }))
    const label = document.createElement("div")
    label.textContent = "Unlocks while an agent is working"
    overlay.append(icon, label)
    document.documentElement.appendChild(overlay)
  }
  if (window.__xvLock) return
  window.__xvLock = true
  const keys = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "j", "k", "."])
  const editable = (target) =>
    target instanceof Element &&
    !!target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']")
  addEventListener("wheel", (event) => { if (window.__xvLocked) event.preventDefault() }, { capture: true, passive: false })
  addEventListener("keydown", (event) => {
    if (!window.__xvLocked || event.metaKey || event.ctrlKey || event.altKey) return
    if (!keys.has(event.key) || editable(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
})()`

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
  const idleLock = ctx.options.idleLock !== false

  const partition = session.fromPartition(PARTITION)
  partition.setUserAgent(chromeUserAgent(partition.getUserAgent()))

  const views = new Map<number, View>()
  /** Each window's scroll lock, kept apart from its view so a lock sent before the view exists still applies. */
  const locks = new Map<number, boolean>()

  // Before `provide`: it reads the state of the windows already open right away.
  const live = (window: number) => {
    const contents = views.get(window)?.view.webContents
    return contents && !contents.isDestroyed() ? contents : undefined
  }

  const provider = ctx.provide(XView, {
    state: (window) => {
      const contents = typeof window === "number" ? live(window) : undefined
      if (!contents) return { url: "", loading: false, canGoBack: false, canGoForward: false, locked: false }
      return {
        url: contents.getURL(),
        loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        locked: typeof window === "number" && !!locks.get(window),
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
    lock: ({ locked }, caller) => {
      locks.set(caller.window, idleLock && locked)
      applyLock(caller.window)
      provider.changed(caller.window)
    },
    close: (_input, caller) => dispose(caller.window),
  })

  const applyLock = (window: number) => {
    const contents = live(window)
    if (contents && isX(contents.getURL())) {
      void contents.executeJavaScript(lockScript(locks.get(window) ?? false)).catch(() => {})
    }
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
    contents.on("dom-ready", () => applyLock(windowId))
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

  ctx.windows.on("close", (window) => {
    dispose(window.id)
    locks.delete(window.id)
  })
  ctx.onCleanup(() => {
    for (const windowId of [...views.keys()]) dispose(windowId)
  })
}
