# github

GitHub pull requests and local git branches in the OpenCode Desktop side panel, modeled on the T3 Code PR panel.

Uses the GitHub CLI on the machine running the OpenCode server, so `gh auth login` must be done.

## Features

- **Branches tab**: the session repository's local and remote branches (upstream, ahead/behind, checked out
  elsewhere in a worktree), with checkout, create, rename, delete, merge-into-current, fetch / pull / push, and a
  commit graph (Local / Current / All) drawn like the screenshot's Git panel. Commands: *Open branches*,
  *Checkout branch…*, *New branch…*. A composer pill shows the current branch.
- **Pull requests tab**:  the open PRs of the session's repository, grouped into *Needs your review*, *Your pull
  requests* and *Everything else*. Search by title, `#number`, branch, author or label, and filter by
  Open / Closed / Merged / All. Cmd-click a row to open it on GitHub.
- **One tab per PR** (`#123 Title`) with three views:
  - **Summary**: description, labels, merge status, reviewers and checks.
  - **Timeline**: comments, reviews and commits, plus a box to post a comment.
  - **Code**: every changed file's diff with:
    - *Viewed* checkboxes synced with GitHub's own viewed marks; viewed files collapse.
    - Click the `+` on a line (shift-click to select a range) to write a comment, then either
      **Add to review** (kept as a pending draft) or **Ask agent** (quotes the lines into the chat composer).
    - Existing review threads shown inline, with replies.
    - **Review** submits pending comments as Comment / Approve / Request changes.
- **Header actions**: Review with agent (opens a draft session that's already prompted to review the PR), Check out,
  Merge (squash / merge / rebase), Mark ready, Attach to chat, Copy link, Open on GitHub.
- **Composer pill** showing the PR for the session's current branch and its check status.
- **Commands**: *Open pull requests*, *Open pull request…* (searchable picker), *Open pull request for current branch*.
  You can bind keys to them in Settings > Shortcuts.

## Development

```sh
bun install
bun run dev        # vite build --watch; each rebuild reloads the GUI in every window
bun run typecheck
```

The server part (`src/index.ts`) runs from source. Restart the service after changing it: `opencode service restart`.

Options (in `opencode.json`):

```jsonc
{ "plugins": [{ "package": "/Users/timrekelj/.config/opencode/plugins/github", "options": { "gh": "/opt/homebrew/bin/gh", "limit": 300 } }] }
```
