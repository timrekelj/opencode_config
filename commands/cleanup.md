---
description: Small cleanup after feature is working
agent: test-writer
model: opencode-go/minimax-m2.5
---

Cleanup target: $ARGUMENTS

Only perform safe cleanup that supports the current change.

Allowed:

- Remove dead code introduced by this change.
- Rename local variables for clarity.
- Simplify obvious duplication.
- Improve tests around this change.

Not allowed unless explicitly requested:

- Broad formatting.
- Public API changes.
- Architecture changes.
- Dependency changes.

Run focused verification after cleanup.
