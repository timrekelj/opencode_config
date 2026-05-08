---
description: Run post-change verification cheaply
agent: quickfix
model: opencode-go/deepseek-v4-flash
---

Verification target: $ARGUMENTS

Verify the current working tree.

Start with focused checks, then broader checks if practical:

- Relevant unit/integration tests.
- Typecheck.
- Lint.
- Build.

Summarize commands run and results. Do not edit files.
