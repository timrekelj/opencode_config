---
description: Full review: code, security, and tests
agent: review
model: openai/gpt-5.5
---

Review the current change. Do not edit files.

Current status:

!`git status --short`

Diff stat:

!`git diff --stat`

Unstaged diff:

!`git diff`

Staged diff stat:

!`git diff --cached --stat`

Staged diff:

!`git diff --cached`

Review criteria:

**Code:**
- Correctness and regressions.
- Concurrency, async, migration, and rollback issues.
- Unnecessary complexity.

**Security:**
- Authentication and authorization bugs.
- Access-control bypasses.
- Injection, XSS, CSRF, SSRF, path traversal, unsafe deserialization.
- Secrets or sensitive data exposure.
- Data-loss or tenant-isolation risks.

**Tests:**
- Whether tests cover the changed behavior.
- Missing edge cases.
- Flaky async/timing/randomness problems.
- Over-mocking or testing implementation details.

Output format:
- Blockers.
- High confidence issues.
- Medium/low issues.
- Missing tests.
- Residual risks.
- LGTM only if there are no material issues.

For each issue, include file/function, why it matters, and a concrete fix.