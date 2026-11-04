# side-chat

A temporary side chat in an OpenCode Desktop side panel, like Claude Code's `/btw` but interactive: ask side questions
about the session you are in without adding them to its history.

- Opening it forks the routed session. The fork sees everything the main session has said and done up to that
  moment, and the panel shows only what is said after it.
- The fork is read-only: an `edit: deny` rule is appended to its permissions (the last matching rule wins). It can
  still read, search and run commands under your normal rules; their permission prompts show in the panel.
- Closing the tab deletes the fork. So does a window reload: side chats left behind by a closed window, a reload or a
  crash are deleted by any open window once their window has stopped its heartbeat for 5 minutes and their server is
  connected. Other windows' open side chats are left alone. A failed delete is retried; forks of a server that is not
  reachable for 7 days are forgotten.
- **Start over** (↻) deletes the fork and forks the main session again, picking up what it did since.
- Each finished answer can be copied, or added to the main session's prompt.

Open it from the session panel's + menu, the *Open side chat* command (`mod+shift+B`), or type `/side <question>` in
the main composer to open the side chat and ask there in one go.

While it exists the fork is a normal session, so it is listed with the project's sessions, titled
`Side chat · <main title>`.

## Development

```sh
bun install
bun run dev        # vite build --watch
bun run typecheck
```
