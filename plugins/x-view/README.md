# x-view

x.com as a tab in the OpenCode Desktop session side panel, next to the Pull requests, Usage and Devices tabs. Log
in once and it stays logged in across restarts.

The desktop's built-in browser pane forgets its cookies when OpenCode restarts, and x.com sends
`X-Frame-Options: SAMEORIGIN`, so an iframe can't show it either. Instead, the plugin's main-process part creates its
own `WebContentsView` in the `persist:x-view` partition (cookies on disk, encrypted with the macOS Keychain) and embeds
it in the panel tab. The partition is separate from the agent's browser pane, so the agent's browser tools never see
your X login.

- Navigation stays on x.com / twitter.com. Other links (t.co targets, articles) open in the default browser.
- "Sign in with Google / Apple" opens in a small popup window that shares the partition. The view sends a plain
  Chrome user agent, without the Electron and app tokens Google rejects as an embedded browser.
- One view per app window, created the first time the tab shows. Closing the tab closes the view; the login stays.
- To log out for good, log out inside X.

## Where it shows

- **X** item in the session panel **+** menu.
- **Open X** command (bind a key in Settings > Shortcuts via the `x-view.open` keybind).

The toolbar has back, forward, reload, the current address (click it to go back to the start page), open in the
default browser, and DevTools.

## Options (in `opencode.json`)

```jsonc
{
  "plugins": [
    {
      "package": "/Users/timrekelj/.config/opencode/plugins/x-view",
      "options": { "url": "https://x.com/notifications" }
    }
  ]
}
```

`url` is the start page. It defaults to `https://x.com/home` and must be an `https` URL on x.com or twitter.com;
anything else falls back to the default.

`idleLock` (default `true`) locks the page while no agent is working: a gray overlay with a lock covers it and takes
the clicks, and it blocks wheel and trackpad scrolling, and the keys that
scroll or move through the timeline (space, arrows, Page Up/Down, Home/End, `j`, `k`, `.`), outside text fields. Any
running session on any server the app lists unlocks it. A lock icon in the toolbar shows when it's on. Set it to
`false` to scroll freely.

## Layout

- `src/index.ts`: server part, a no-op. The plugin only needs the package entry and its options.
- `src/contract.ts`: the `XView` Ipc between windows and main: page state (url, loading, back/forward) and the
  toolbar's methods.
- `src/main.ts`: main process. The persistent partition, its user agent, one embedded view per window, and the
  navigation and popup rules.
- `src/gui.tsx`: window setup. Registers the panel tab, the menu item and the command.
- `src/gui/view.tsx`: the tab: toolbar and embed.

## Development

```sh
bun install
bun run dev        # vite build --watch; each rebuild reloads the GUI in every window
bun run typecheck
```
