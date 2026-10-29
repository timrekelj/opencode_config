# usage-view

Token usage and an **estimated API-equivalent cost** for OpenCode Desktop. This is useful when you use a subscription,
because `cost` is then 0 everywhere and the model catalog's prices are zeroed.

## Where it shows

- **Usage** side-panel tab: in the session panel **+** menu, or the *Show usage* command.
- **Settings → Usage**: works without an open session. *Show usage* opens this page when no session is open.

## Features

- **Range**: Today (hourly), 7 days and 30 days (daily), All time (daily, or about 12 weekly buckets).
- **Scope**: this project (the current session's project) or all projects.
- **Summary**: estimated API cost, actual billed cost, total tokens (input / output+reasoning / cache read / cache
  write), sessions / prompts / steps / subagents, active days and streak.
- **Over time** line chart, by cost or tokens, with a tooltip on each point.
- **By model**: steps, tokens, estimated cost and share.
- **Tools**: calls, failure rate and median (p50) duration.
- **Top sessions** active in the range, sorted by tokens. Click one to open it. These are lifetime totals for each
  session, priced at the session's current model, so they're approximate (≈).

## How cost is estimated

Prices come from [models.dev](https://models.dev/api.json), in USD per million tokens. The server part fetches them
and caches them for 6 hours.

```
est = (input·in + (output + reasoning)·out + cache.read·cache_read + cache.write·cache_write) / 1e6
```

The four terms are also shown on their own as the cost by type. Cache savings is what cache reads would have cost at
the full input price, minus what they cost at the cache read price:

```
savings = cache.read · (in − cache_read) / 1e6
```

Matching order:

1. The exact `provider/model` pair.
2. The same model id with any `provider/` prefix, `[1m]`-style variant, `:tag` or `-YYYYMMDD` suffix removed. Bare
   family names (`opus`, `sonnet`, `haiku`, `fable`) are never priced. The model's own provider is
   searched first, then anthropic, openai, google and the rest. Only paid entries count here.

A model with no match shows `—`. A total that mixes priced and unpriced models is shown as `≥ $x`.

## Deleted sessions

Usage is kept after a session is deleted. The server part keeps its own copy of every session's usage in plugin
storage: tokens, cost and steps per model, in 15-minute slots. When a session disappears from OpenCode, the copy is
marked deleted and its usage is added to OpenCode's own stats for the same range.

- It reads OpenCode's database (`~/.local/share/opencode/opencode.db`, or under `$XDG_DATA_HOME`) and only runs
  `SELECT`s. Set the `database` option to use another file.
- It syncs at startup, about 2 seconds after each finished step, compaction or deletion, and every 5 minutes. Each
  sync only re-reads sessions with messages written since the last one.
- Kept: tokens, cost, steps, and session and subagent counts. Not kept: prompts, tool calls, active days and the
  sessions list.
- Usage from before the plugin was first loaded is only kept for sessions that still existed then.
- Kept usage expires after 92 days, like t3code's: slots older than that are dropped, and a deleted session's copy is
  removed once none are left. Set the `retentionDays` option to change it.

## Layout

- `src/index.ts`: server part. Registers the `usage-view` RPC (`prices`, `retained`) and starts the ledger.
- `src/ledger.ts`: the copy of each session's usage, so deleted sessions still count.
- `src/pricing.ts`: models.dev fetch, cache and model matching.
- `src/rpc.ts`: RPC definition, in portable JSON Schema.
- `src/gui.tsx`: GUI entry. Registers the panel, menu item, command and settings page.
- `src/gui/api.ts`: loads the data with `session.stats` (one call per chart bucket, in parallel), `session.list` and
  the `prices` and `retained` RPCs, and adds the deleted sessions' usage to the stats.
- `src/gui/usage.tsx`: the view. `src/gui/format.ts` holds the number formatting. `src/gui/style.css` holds the styles.

## Development

```sh
bun install
bun run build      # or: bun run dev (vite build --watch)
bun run typecheck
```

Test the RPC with a private server:

```sh
OPENCODE_CONFIG_CONTENT='{"plugins":["/Users/timrekelj/.config/opencode/plugins/usage-view"]}' \
  opencode api post /api/rpc/usage-view/prices --standalone \
  --data '{"input":{"models":[{"providerID":"anthropic","id":"claude-opus-5-5"}]}}'
```

Register the plugin in `opencode.json`. The `url` option is optional and overrides the models.dev URL:

```jsonc
{ "plugins": ["/Users/timrekelj/.config/opencode/plugins/usage-view"] }
```
