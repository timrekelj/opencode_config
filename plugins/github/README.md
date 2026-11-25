# github

Local git branches in the OpenCode Desktop side panel, plus an automatic `/review` after `gh pr create`.

## Features

- **Branches tab**: the session repository's local and remote branches (upstream, ahead/behind, checked out
  elsewhere in a worktree), with checkout, create, rename, delete, merge-into-current, fetch / pull / push, and a
  commit graph (Local / Current / All). Commands: *Open branches*, *Checkout branch…*, *New branch…*. A composer
  pill shows the current branch.
- **Auto review**: when a `gh pr create` shell call succeeds, `/review <PR URL>` runs in the session, queued after the
  current turn, once per PR. If a subagent created the PR, it runs in the top-level session. This needs the GitHub CLI
  (`gh`) available to the agent's shell, but the plugin itself only runs `git`.

## Development

```sh
bun install
bun run dev        # vite build --watch; each rebuild reloads the GUI in every window
bun run typecheck
bun run test
bun run build   # writes dist/gui-experimental.cjs
```

The server part (`src/index.ts`) runs from source. Restart the service after changing it: `opencode service restart`.

Options (in `opencode.json`):

```jsonc
{ "plugins": [{ "package": "/Users/timrekelj/.config/opencode/plugins/github", "options": { "limit": 300, "autoReview": false } }] }
```

`limit` caps the commit graph size. `autoReview: false` disables the automatic `/review` after `gh pr create`.
