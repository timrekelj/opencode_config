# x-view

Open x.com as a tab in the OpenCode Desktop session side panel, next to the Pull requests and Usage tabs.

It uses the desktop's built-in browser pane (`Browser.open`), so the full x.com loads in the panel: log in
once there and your feed, notifications and everything else work. x.com sends `X-Frame-Options: SAMEORIGIN`,
so it cannot be embedded in an iframe inside a custom tab — a real browser tab is the only way to show the
logged-in site.

When the session has no browser pane (web app, pane disabled), it falls back to the system browser.

## Where it shows

- **X** item in the session panel **+** menu.
- **Open X** command (bind a key in Settings > Shortcuts via the `x-view.open` keybind).

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

`url` defaults to `https://x.com/home`. It must be an `http(s)` URL — anything else falls back to the default.

## Layout

- `src/index.ts`: server part, a no-op — the plugin only needs the package entry and its options.
- `src/gui.tsx`: GUI entry. Registers the menu item and command; opens the URL in the session's browser
  pane via the `Browser` contract, else in the system browser.

## Development

```sh
bun install
bun run dev        # vite build --watch; each rebuild reloads the GUI in every window
bun run typecheck
```

Register the plugin in `opencode.json`:

```jsonc
{ "plugins": ["/Users/timrekelj/.config/opencode/plugins/x-view"] }
```
