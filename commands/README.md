# OpenCode Commands Reference

A complete guide to all available OpenCode commands, their use cases, models, and the rules that govern them.

---

## Quick Navigation

| Command | Purpose | Model | Cost |
|---------|---------|-------|------|
| `/triage` | Initial investigation | DeepSeek V4 Flash | Cheap |
| `/quickfix` | Small bug fixes | DeepSeek V4 Flash | Cheap |
| `/implement` | Normal implementation | MiniMax M2.7 | Normal |
| `/code-hard` | Complex implementation | Kimi K2.6 | Premium |
| `/frontend` | Frontend/UI work | Kimi K2.6 | Premium |
| `/debug` | Hard debugging | DeepSeek V4 Pro | Premium |
| `/plan` | Plan changes | Qwen 3.6 Plus | Normal |
| `/plan-hard` | Architecture review | GLM 5.1 | Premium |
| `/write-tests` | Add tests | MiniMax M2.5 | Normal |
| `/fix-tests` | Fix failing tests | MiniMax M2.7 | Normal |
| `/test` | Run tests | DeepSeek V4 Flash | Cheap |
| `/verify` | Post-change verification | DeepSeek V4 Flash | Cheap |
| `/review` | Code review | GPT-5.5 | Premium |
| `/review-tests` | Test quality review | GPT-5.5 | Premium |
| `/review-security` | Security review | GPT-5.5 | Premium |
| `/review-go-fallback` | Review when GPT-5.5 unavailable | GLM 5.1 | Premium |
| `/refactor` | Large refactors | MiMo V2.5 Pro | Premium |
| `/cleanup` | Safe cleanup | MiniMax M2.5 | Normal |
| `/docs` | Documentation | Qwen 3.5 Plus | Cheap |
| `/commit` | Draft commit message | Qwen 3.5 Plus | Cheap |
| `/pr` | Draft PR description | Qwen 3.5 Plus | Cheap |
| `/checkpoint` | Create session checkpoint | Qwen 3.5 Plus | Cheap |
| `/handoff` | Prepare handoff prompt | Qwen 3.5 Plus | Cheap |
| `/repo-map` | Map repository structure | DeepSeek V4 Flash | Cheap |

---

## Investigation & Planning Commands

### `/triage`
- **Model**: `opencode-go/deepseek-v4-flash`
- **Agent**: `explore`
- **When to use**: Before starting any work. Use this to understand what you're dealing with.
- **What it does**: Cheap read-first investigation that finds relevant files, functions, tests, and recent changes. Recommends which command to use next (`/quickfix`, `/implement`, `/debug`, `/code-hard`, or `/plan-hard`).
- **Does not edit files**.

### `/repo-map`
- **Model**: `opencode-go/deepseek-v4-flash`
- **Agent**: `explore`
- **When to use**: When you need to understand the overall structure of a repository.
- **What it does**: Maps main directories, build/test/lint commands, key entry points, and relevant files for your goal.
- **Does not edit files**.

### `/plan`
- **Model**: `opencode-go/qwen3.6-plus`
- **Agent**: `plan`
- **When to use**: Before implementing medium-complexity changes.
- **What it does**: Produces a plan with goals/non-goals, architecture, files to change, step-by-step implementation, test strategy, and risks.
- **Does not edit files**.

### `/plan-hard`
- **Model**: `opencode-go/glm-5.1`
- **Agent**: `architect`
- **When to use**: For complex architecture decisions or when you need a senior review of a proposed approach.
- **What it does**: Premium architecture critique focusing on simpler options, API boundaries, migration risks, security, concurrency, and testability.
- **Does not edit files**.

---

## Implementation Commands

### `/quickfix`
- **Model**: `opencode-go/deepseek-v4-flash`
- **Agent**: `quickfix`
- **When to use**: For small, low-risk, obvious bugs only.
- **What it does**: Minimal diff fix. Inspects exact code path, fixes root cause if obvious, runs smallest verification.
- **Important**: If not clear after two attempts, stops and recommends `/debug` or `/plan`.

### `/implement`
- **Model**: `opencode-go/minimax-m2.7`
- **Agent**: `build`
- **When to use**: Standard production code changes of normal complexity.
- **What it does**: Careful implementation following existing patterns. Restates intent, inspects files, makes smallest safe diff, adds tests, runs verification.
- **Important**: Stops and asks if breaking API changes, destructive migrations, or secret access are required.

### `/code-hard`
- **Model**: `opencode-go/kimi-k2.6`
- **Agent**: `hard-code`
- **When to use**: Difficult implementation, complex cross-file changes, or when `/implement` isn't enough.
- **What it does**: Handles hard implementation with careful code path identification, consistent architecture, logical chunk changes, and focused verification.

### `/frontend`
- **Model**: `opencode-go/kimi-k2.6`
- **Agent**: `hard-code`
- **When to use**: Frontend or UI implementation work.
- **What it does**: Implements using existing UI architecture. Inspects components, state, routing, styling, accessibility. Preserves responsive behavior and handles loading/error states.

### `/refactor`
- **Model**: `opencode-go/mimo-v2.5-pro`
- **Agent**: `long-refactor`
- **When to use**: Large-context refactoring that spans many files.
- **What it does**: Incremental refactoring with mechanical, reviewable steps. Identifies behavior to preserve, public APIs, and migration path. Avoids mixing behavior changes with refactors.

### `/cleanup`
- **Model**: `opencode-go/minimax-m2.5`
- **Agent**: `test-writer`
- **When to use**: After a feature is working and you want safe cleanup.
- **What it does**: Removes dead code, renames variables, simplifies duplication, improves tests.
- **Important**: Does NOT do broad formatting, public API changes, architecture changes, or dependency changes unless explicitly requested.

---

## Debugging Commands

### `/debug`
- **Model**: `opencode-go/deepseek-v4-pro`
- **Agent**: `debug`
- **When to use**: For hard bugs requiring root-cause analysis.
- **What it does**: Evidence-first debugging: reproduce, identify failing behavior, trace code path, isolate root cause, smallest safe fix, re-test.
- **Important**: Does not mask failures, weaken tests, or make broad unrelated changes.

---

## Testing Commands

### `/test`
- **Model**: `opencode-go/deepseek-v4-flash`
- **Agent**: `quickfix`
- **When to use**: To run and summarize relevant tests.
- **What it does**: Runs the most relevant test command, summarizes pass/fail, key failures, and recommends next steps.
- **Important**: Does not edit files unless explicitly asked to fix failures.

### `/write-tests`
- **Model**: `opencode-go/minimax-m2.5`
- **Agent**: `test-writer`
- **When to use**: When you need to add or improve tests.
- **What it does**: Inspects existing test style, identifies behavior to cover, adds smallest useful tests with behavior-focused assertions. If code is hard to test, explains the seam or recommends a refactor.

### `/fix-tests`
- **Model**: `opencode-go/minimax-m2.7`
- **Agent**: `build`
- **When to use**: When tests are failing and you need to fix them.
- **What it does**: Detects test command, runs smallest failing test, identifies if product or test code is wrong, fixes root cause, re-runs focused then broader tests.
- **Important**: Does not delete, skip, loosen, or rewrite tests merely to make the suite green. Explains why if a test is invalid.

### `/verify`
- **Model**: `opencode-go/deepseek-v4-flash`
- **Agent**: `quickfix`
- **When to use**: After making changes to confirm nothing is broken.
- **What it does**: Runs focused checks (unit/integration tests, typecheck, lint, build) and summarizes results.
- **Does not edit files**.

---

## Review Commands

### `/review`
- **Model**: `openai/gpt-5.5`
- **Agent**: `review`
- **When to use**: Before merging or submitting code. Final review of current diff.
- **What it does**: Reviews for correctness, regressions, security, data-loss, missing tests, concurrency, async, migration, rollback, and unnecessary complexity.
- **Output**: Blockers, high/medium/low issues, missing tests, residual risks. Only says LGTM if no material issues.
- **Does not edit files**.

### `/review-tests`
- **Model**: `openai/gpt-5.5`
- **Agent**: `review`
- **When to use**: When you want focused feedback on test quality.
- **What it does**: Reviews whether tests cover changed behavior, missing edge cases, incorrect assumptions, flaky tests, over-mocking, brittle snapshots, and tests that pass while feature is broken.
- **Does not edit files**.

### `/review-security`
- **Model**: `openai/gpt-5.5`
- **Agent**: `security-review`
- **When to use**: When the change touches authentication, authorization, user input, or sensitive data.
- **What it does**: Security-focused review for auth bugs, access-control bypasses, injection, XSS, CSRF, SSRF, path traversal, secrets exposure, unsafe logging, data-loss risks, and supply-chain risks.
- **Output**: Findings by severity with concrete fixes, or confirmation of no material findings.
- **Does not edit files**.

### `/review-go-fallback`
- **Model**: `opencode-go/glm-5.1`
- **Agent**: `architect`
- **When to use**: Only when GPT-5.5 is unavailable and you still need a review.
- **What it does**: Fallback review for correctness, regressions, missing tests, security risks, data-loss risks, and unnecessary complexity.
- **Does not edit files**.

---

## Documentation & Communication Commands

### `/docs`
- **Model**: `opencode-go/qwen3.5-plus`
- **Agent**: `docs`
- **When to use**: When you need to update docs, comments, or developer notes.
- **What it does**: Updates or drafts documentation based on the codebase. Keeps docs accurate, concise, and developer-friendly. Includes commands, examples, and caveats. Does not invent unsupported behavior.

### `/commit`
- **Model**: `opencode-go/qwen3.5-plus`
- **Agent**: `docs`
- **When to use**: When you need a commit message draft.
- **What it does**: Drafts a conventional commit subject, short body explaining why (not just what), and test notes.
- **Important**: Does not run `git commit`.
- **Does not edit files**.

### `/pr`
- **Model**: `opencode-go/qwen3.5-plus`
- **Agent**: `docs`
- **When to use**: When you need a PR description draft.
- **What it does**: Creates summary, motivation, implementation notes, testing performed, risk/rollback notes, and reviewer checklist.
- **Does not edit files**.

---

## Session Management Commands

### `/checkpoint`
- **Model**: `opencode-go/qwen3.5-plus`
- **Agent**: `plan`
- **When to use**: Before compaction or switching models/features.
- **What it does**: Creates a compact checkpoint with goal, current state, decisions, files changed, test results, constraints, remaining tasks, and recommended next command.
- **Does not edit files**.

### `/handoff`
- **Model**: `opencode-go/qwen3.5-plus`
- **Agent**: `plan`
- **When to use**: When switching to another model or fresh session.
- **What it does**: Prepares a copy-pasteable handoff prompt with task goal, architecture, diff summary, test results, remaining issues, and what the next model should do first.
- **Does not edit files**.

---

## Rules

### Development Rules

Guidelines for writing code:

- **Make the smallest safe change** that solves the task.
- **Preserve public APIs** unless the task explicitly asks for an API change.
- **Prefer simple code** over clever abstractions.
- **Keep error handling** explicit and actionable.
- **Avoid broad rewrites** during bug fixes.
- **Before editing**, check nearby code for existing conventions.
- **After editing**, inspect `git diff` before claiming completion.

### Testing Rules

Guidelines for writing and maintaining tests:

- Tests should **verify behavior**, not implementation details.
- **Prefer focused tests** near the changed code.
- **Cover the failure mode** or edge case that motivated the change.
- **Avoid brittle timing**, network, randomness, and snapshot-heavy tests unless the repo already uses them intentionally.
- **Do not delete, skip, or weaken tests** without explaining why the original test was invalid.
- **When fixing tests**, first determine whether the product code or the test is wrong.

### Review Rules

Guidelines for code reviews. Reviews should prioritize:

1. **Correctness and regressions**.
2. **Security and data-loss risks**.
3. **Missing or weak tests**.
4. **Concurrency, async, migration, and rollback issues**.
5. **Maintainability issues** that will matter soon.

- Avoid cosmetic nits unless they hide a real problem.

### Compaction Rules

Guidelines for when to compact/summarize session state:

Good times to compact:

- After a plan is agreed.
- After a passing test run.
- After a long debugging/log-reading phase.
- Before final review.
- Before switching to another feature.

- **Before compacting**, run `/checkpoint` and make sure the summary includes goal, decisions, changed files, test status, known constraints, remaining tasks, and things not to revisit.

---

## Command Selection Flowchart

```
Start
  |
  v
/triage (cheap investigation)
  |
  +---> Simple bug? --------> /quickfix
  |
  +---> Normal change? -----> /plan (optional) --> /implement
  |
  +---> Complex/hard? ------> /plan-hard (optional) --> /code-hard or /debug
  |
  +---> Frontend/UI? -------> /frontend
  |
  +---> Need tests? --------> /write-tests
  |
  +---> Tests failing? -----> /fix-tests
  |
  +---> Large refactor? ----> /refactor
  |
After implementation
  |
  +---> Verify changes? ----> /verify or /test
  |
  +---> Review code? -------> /review
  |
  +---> Review tests? ------> /review-tests
  |
  +---> Security review? ---> /review-security
  |
  +---> Need docs/PR? ------> /docs or /pr or /commit
  |
  +---> Switching context? -> /checkpoint or /handoff
```

---

## Model Reference

| Model | Strengths | Typical Use |
|-------|-----------|-------------|
| **DeepSeek V4 Flash** | Fast, cheap | Triage, quick fixes, verification, repo mapping, running tests |
| **DeepSeek V4 Pro** | Strong reasoning | Hard debugging and root-cause analysis |
| **Qwen 3.5 Plus** | Balanced, cheap | Documentation, commit messages, PR descriptions, checkpoints, handoffs |
| **Qwen 3.6 Plus** | Better planning | Change planning and architecture overview |
| **MiniMax M2.5** | Test-focused | Writing tests, safe cleanup |
| **MiniMax M2.7** | Solid engineering | Normal implementation, fixing tests |
| **Kimi K2.6** | Complex tasks, UI | Hard implementation, frontend work, cross-file changes |
| **GLM 5.1** | Architecture | Premium architecture critique, fallback review |
| **MiMo V2.5 Pro** | Large context | Large-scale refactoring across many files |
| **GPT-5.5** | Best review quality | Final code review, test review, security review |
