# discord-presence

OpenCode server plugin that shows your OpenCode activity as Discord Rich Presence. It talks to the Discord desktop app
directly over its local IPC socket (no extra dependencies).

## What is shown

- **Project**: the folder names of all projects with a running session, most recently active first, joined with commas
  and collapsed into `+N` when they do not fit (`weekendr-backend, opencode +3`). With nothing running, the project you
  used most recently.
- **Status**: `Working · <model>` while any session is running, `Idle · <model>` otherwise.
- **Timer**: how long the presence has been shown. It keeps counting across Working/Idle switches and restarts only after the idle timeout cleared the presence (or all sessions were deleted).
- **Image**: a large "OpenCode" image. Hovering it shows `Spent today: $4.20`, your estimated API spend since local
  midnight (`<$0.01` for tiny amounts), computed like the **usage-view** plugin's "Estimated cost" (token estimate at
  models.dev prices, recorded cost for models without a price). It requires the usage-view plugin to be loaded; without
  it the hover text stays `OpenCode`. It refreshes at startup, when a session finishes and once a minute while one is
  working.

Nothing else is shared: no session titles, file names, prompts or tool names. This, including the spend shown on hover,
is visible to your Discord friends and anyone who can see your profile. Set `showSpend` to `false` to hide the spend.

After `idleTimeout` minutes without activity the presence is cleared; the next activity brings it back.

## Setup

1. Open <https://discord.com/developers/applications> and create a new application named **OpenCode**. The name is what
   Discord shows as "Playing OpenCode".
2. Copy its **Application ID** and set it as the `clientId` option in `opencode.json`.
3. In the application, go to **Rich Presence → Art Assets** and upload an image named `opencode`.
4. Keep the Discord desktop app running and turn on **Settings → Activity Privacy → Share your activity**.

```json
{
  "package": "/Users/timrekelj/.config/opencode/plugins/discord-presence",
  "options": { "clientId": "123456789012345678" }
}
```

Without a `clientId` the plugin logs one warning and does nothing.

## Options

| Option             | Type    | Default    | Description                                                                          |
| ------------------ | ------- | ---------- | ------------------------------------------------------------------------------------ |
| `clientId`         | string  | (required) | Discord Application ID.                                                              |
| `largeImage`       | string  | `opencode` | Name of the Rich Presence art asset used as the large image.                         |
| `idleTimeout`      | number  | `15`       | Minutes of idle with no events before the presence is cleared.                       |
| `maxDetailsLength` | integer | `32`       | Max length of the project line (Discord's profile card truncates around 32; cap 128). |
| `showSpend`        | boolean | `true`     | Show today's estimated spend on the large image hover (needs the usage-view plugin). |

## Behaviour

- If Discord is not running the plugin retries quietly (15s, doubling up to 60s) and logs once per disconnect.
- Updates are coalesced to at most one every ~4 seconds to stay under Discord's rate limit.
- All projects share one connection and one presence.

## Development

```sh
bun install
bun run typecheck
bun test
```
