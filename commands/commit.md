---
description: Draft a commit message from current diff
agent: docs
model: opencode-go/qwen3.5-plus
subtask: true
---

Draft a commit message. Do not edit files.

Current status:

!`git status --short`

Diff stat (unstaged):

!`git diff --stat`

Unstaged diff:

!`git diff`

Staged diff stat:

!`git diff --cached --stat`

Staged diff:

!`git diff --cached`

Return:

1. A concise conventional commit subject if appropriate.
2. A short body explaining why, not just what.
3. Any test notes to include.

Do not run `git commit`.
