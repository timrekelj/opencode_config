---
description: review changes [commit|branch|pr], defaults to uncommitted
agent: reviewer
subagent: true
---
Review the changes described by this argument: `$ARGUMENTS`

- Empty: review uncommitted changes. Run `git diff HEAD` and read any untracked files from `git status --short`.
- A number: it is a pull request. Run `gh pr view <number>` and `gh pr diff <number>`.
- Anything else: it is a commit or branch. For a commit, run `git show <commit>`. For a branch, run `git diff <default-branch>...<branch>`, where the default branch comes from `git symbolic-ref refs/remotes/origin/HEAD` or is `main`/`master`.

Report findings as bugs, then missing tests, then risks and nits, each with `file:line`. If there are no issues, say so.
