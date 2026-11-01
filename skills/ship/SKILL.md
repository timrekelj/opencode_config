---
name: ship
description: Commit, push and open pull requests to development (or staging) in the current repo and every sibling repo with related changes, cross-linking the PRs and the Linear ticket. Use when asked to commit, push, open a PR or ship work.
---

# ship

**Base branch:** `development` if the repo has it, else `staging`, else ask.

1. **Repos:** the current repo, plus siblings from `AGENTS.md` with uncommitted changes or a branch ahead of base for this work. If anything is unclear (unrelated changes, missing ticket, merge order), ask all of it in one numbered message before the first commit.
2. **Per repo:**
   - If on a protected branch (`development`, `staging`, `main`/`master`, `production`), create `fix/…`, `feat/…` or `chore/…` plus the Linear id.
   - Never commit secrets, `.env` files, build output or scratch files.
   - Make small conventional commits (`fix(feed): …`).
   - Push with `-u`.
   - `gh pr create --base <base>`, or update the PR if one exists.
3. **PR body:**
   ```
   ## What
   ## Why            (root cause for bugs)
   ## How it was verified   (say plainly what wasn't)
   ## Related        (Linear, Figma, sibling PRs)
   ## Notes for review / deploy   (migrations, env vars, merge order; omit if none)
   ```
4. **Cross-link:** once all PRs exist, edit each so it links the others and states the merge order. Comment the PR links on the Linear ticket and move it to **In Review**.
5. **Report:** one line per repo with the PR link and branch, plus anything the user still has to do.
