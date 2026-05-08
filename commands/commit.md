---
description: Stage and commit changes
agent: general
model: opencode-go/qwen3.5-plus
subtask: true
---

Stage and commit changes.

Current status:

!`git status --short`

If nothing is staged or modified, stop and report that there is nothing to commit.

Diff stat (unstaged):

!`git diff --stat`

Unstaged diff:

!`git diff`

Staged diff stat:

!`git diff --cached --stat`

Staged diff:

!`git diff --cached`

Determine the commit message:
- If $ARGUMENTS is non-empty, use it directly.
- Otherwise, invoke the `write-commit` subagent via the Task tool to draft a conventional commit message from the diff above. Extract the full message (subject + body) from its response.

Then stage all changes and commit:

```
git add -A && git commit -m "<message>"
```

Replace `<message>` with the determined commit message.
