---
name: branches
description: Audit local branches, remote branches and git worktrees not merged into development (or staging), recommend merge, keep or delete for each, and clean up only after the user confirms.
metadata:
  opencode/autoinvoke: false
---

# branches

Audit the current repo, the repos given, or all sibling repos from `AGENTS.md` if asked. If the scope is unclear (which repos, include remotes?), ask once up front. For several repos, give each one to a `general` subagent and merge the tables.

**Base branch:** `development` if the repo has it, else `staging`, else ask.

## 1. Gather

```bash
git fetch --all --prune
git worktree list --porcelain
git branch -vv
git branch -r --no-merged origin/<base>
```

For each unmerged branch or worktree, collect:
- ahead/behind and the last commit date and author
- PR state (`gh pr list --head <branch> --state all`)
- whether it was squash-merged (`git cherry origin/<base> <branch>`)
- uncommitted changes in worktrees
- a one-line summary

## 2. Recommend

| Branch / worktree | Ahead / behind | Last commit | PR | Uncommitted | Recommendation | Why |
|---|---|---|---|---|---|---|

Recommendation values:
- **delete:** merged or squash-merged, abandoned, or empty
- **merge:** finished and still relevant (say if it needs a PR or rebase)
- **keep:** in progress
- **ask:** unclear, or a worktree with uncommitted changes

## 3. Clean up

Only clean up what the user confirms:
- worktrees: `git worktree remove <path>` (never `--force` with uncommitted changes unless told to), then `git worktree prune`
- branches: `git branch -d`, or `-D` only for confirmed squash-merges
- remotes: `git push origin --delete <branch>`, only if remotes were explicitly included

Report what was removed.
