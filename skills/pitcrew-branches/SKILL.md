---
name: pitcrew-branches
description: Audit local branches, remote branches and git worktrees that aren't merged into development (or staging), and recommend merge, keep or delete for each. Cleans up only after the user confirms.
metadata:
  opencode/autoinvoke: false
---

# pitcrew-branches

Audit the current repo (or the repos given, or the current repo plus its siblings from `AGENTS.md` if the user asks for all).

**Don't assume the scope.** If it's unclear which repos to audit or whether remote branches are included, ask once up front, together, before gathering.

**Base branch:** `development` if the repo has it, otherwise `staging`. If neither exists, ask. Below, `<base>` means this.

## 1. Gather

When auditing more than one repo, give each repo to its own subagent that runs steps 1–2 and returns only its table; then combine them. Use the `general` subagent for multi-repo audits. For a single repo, do it yourself.

```bash
git fetch --all --prune
git worktree list --porcelain
git branch -vv
git branch -r --no-merged origin/<base>
```

For every local branch, remote branch and worktree not merged into `origin/<base>`, collect:

- commits ahead / behind `origin/<base>` and the last commit date and author
- whether its changes are already in `<base>` another way (squash-merged): check `gh pr list --head <branch> --state all` and `git cherry origin/<base> <branch>`
- PR state (open, merged, closed, none)
- for worktrees: path, branch, and uncommitted or untracked changes (`git -C <path> status --short`)
- a one-line summary of what the branch does

## 2. Recommend

A table per repo:

| Branch / worktree | Ahead / behind | Last commit | PR | Uncommitted | Recommendation | Why |
|---|---|---|---|---|---|---|

Recommendations:
- **delete** — merged (including squash-merged), PR closed and abandoned, or empty
- **merge** — finished, still relevant, should go into `<base>` (say whether it needs a PR or rebase first)
- **keep** — work in progress
- **ask** — unclear, or a worktree with uncommitted changes

## 3. Clean up

Only after the user confirms which ones:
- worktrees: `git worktree remove <path>` (never `--force` on a worktree with uncommitted changes unless the user says so), then `git worktree prune`
- local branches: `git branch -d`; use `-D` only for squash-merged branches you've confirmed
- remote branches: `git push origin --delete <branch>` only if the user explicitly includes remote branches

Report what was removed.
