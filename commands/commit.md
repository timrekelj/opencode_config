---
description: Commit staged changes
agent: general
model: opencode-go/qwen3.5-plus
subtask: true
---

Commit staged changes.

Current status:

!`git status --short`

If nothing is staged, stop and report that there is nothing to commit.

Staged diff stat:

!`git diff --cached --stat`

Staged diff:

!`git diff --cached`

Determine the commit message:
- If $ARGUMENTS is non-empty, use it directly as the commit message.
- Otherwise, draft a conventional commit message following these rules:

Types:
- `feat` — new feature
- `fix` — bug fix
- `refactor` — restructure without changing behavior
- `chore` — dependencies, config, non-src changes
- `perf` — performance improvement
- `ci` — CI/CD changes
- `ops` — infra/deployment
- `build` — build system changes
- `docs` — documentation
- `style` — formatting, whitespace
- `revert` — reverting a previous commit
- `test` — adding or fixing tests

Rules:
- Description: imperative mood, capitalized, brief but informative ("Add", "Fix", "Remove" — not "Added")
- Add `!` after type for breaking changes (e.g. `feat!:`)
- Use scope in parentheses if the change is clearly scoped to one area: `feat(ui):`, `fix(db):`
- Body: only include for complex changes (non-obvious reasoning, multiple concerns, breaking changes, or significant architectural decisions). For simple, self-explanatory changes, omit the body entirely. Separate from header with a blank line when included.
- Footer: only include Closes: #<issue> if the user explicitly mentioned an issue number. Otherwise omit entirely.

Examples

Simple:
```
chore: bump version from 1.0.0+8 to 1.0.0+9
```

With scope:
```
feat(ui): Add like/dislike buttons on AI chat

On pogovori/[id]/page.tsx added two buttons Like and Dislike which change
colour based on state. On click a supabase row chat_messages also gets updated.

Closes: #CLDA-6138
```

Breaking change:
```
fix!: Upgrade Next.js and React versions due to security vulnerabilities

Bumps Next.js and React to latest stable releases to address identified
security issues. The upgrade includes breaking changes in framework APIs,
so existing integrations may require adjustments.

Closes: #CLDA-4556
```

Then commit only the staged files:

```
git commit -m "<message>"
```

Replace `<message>` with the determined commit message.
