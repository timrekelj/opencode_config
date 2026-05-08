---
description: Plan a change with architecture review
agent: plan
model: opencode-go/qwen3.6-plus
---

Task: $ARGUMENTS

Do not edit files.

Inspect the codebase only as needed and produce a plan with:

1. Goal and non-goals.
2. Current architecture or code path involved.
3. Files likely to change.
4. Step-by-step implementation plan.
5. Test strategy, including the smallest useful verification command.
6. Risks, edge cases, and open questions.
7. Architecture critique: simpler options, boundary mistakes, migration risks, data-loss risks, performance pitfalls, testability.

Prefer the simplest design that fits the existing codebase. If the request is ambiguous, state assumptions and ask only the questions that block implementation.