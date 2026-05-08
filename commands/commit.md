---
description: Stage and commit changes
agent: general
model: opencode-go/qwen3.5-plus
subtask: true
---

Stage and commit changes.

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

Commit message (conventional format preferred):

!`echo "Commit message: " && head -n 1 /dev/stdin`

Stage and commit:

!`git add -A && git commit -m "$ARGUMENTS"`
