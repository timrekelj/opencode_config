---
description: Consult relevant review and debugging experts, then synthesize their findings.
agent: build
---

Treat the following as a consultation question. Do not edit files.

Question: $ARGUMENTS

Route the question to whichever experts are genuinely relevant:

- `review`: code quality, correctness, regressions, and style
- `debug`: bug diagnosis, unexpected behavior, stack traces, and root causes

Rules:

1. Invoke only the relevant experts. If neither applies, answer directly and state that the panel was skipped.
2. When both experts apply, launch their `task` calls in parallel in a single message.
3. Give each expert the complete question and any relevant paths, snippets, errors, or constraints.
4. After the experts return, produce one synthesized answer that leads with the recommendation, reconciles disagreements, and identifies unresolved questions.
5. Do not merely concatenate the expert responses.
