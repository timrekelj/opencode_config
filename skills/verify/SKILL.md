---
name: verify
description: Verify finished work by running it locally (backend, web in the in-app browser, mobile simulator or desktop apps via agent-desktop), checking behavior, design and speed, and reviewing the code for bugs and dead code. Use after implementing or fixing something, or to review a branch or PR.
---

# verify

Run it, try it, measure it, then read the code. Report with evidence.

**Base branch:** `development` if the repo has it, else `staging`.

## 1. Scope

- Find what's being reviewed: the given PR or branch, otherwise the current branch. Include sibling repos (from `AGENTS.md`) with related branches.
- Per repo, get `git diff origin/<base>...HEAD` and the intent (Linear ticket, PR description, user's words) plus any Figma links. Review against the intent, not just the diff.
- If the intent or scope is unclear, ask everything in one numbered message with recommended answers. When called from `work`, don't re-ask.
- Start the code review (step 4) now, as one background `general` subagent per repo.

## 2. Run it and check it works

Run only what the change needs, locally, and never against staging or production. Stop it when done. If something can't run, say exactly what's missing. Never fake a result.

| Repo | Run | Exercise |
|---|---|---|
| **Backend** (Go + Supabase) | `supabase start` (reset or seed per `AGENTS.md`), then the API, with `PPROF_ADDR=127.0.0.1:6060` if supported | `curl` the changed endpoints: happy path, bad input, wrong user / no auth, empty data. Check the status codes and the rows written. |
| **Web** (Next.js) | `npm run dev` against the local backend | Load the `browser` skill and use the in-app browser: open the page, `snapshot`, click and fill through the flow, check `console` and `network.list` for errors and failed requests, and check loading, empty and error states. |
| **Mobile** (Expo) | `npm run check`, then the app on the iOS simulator | Run `.maestro/` flows if present. Otherwise drive it with `agent-desktop` (load its skill) and take screenshots with `xcrun simctl io booted screenshot`. Check Metro logs. |
| **Desktop / other GUI** | per `AGENTS.md` | Load the `agent-desktop` skill and drive the app through its accessibility tree. |

Then check:
- The behavior matches the intent, including edge cases. For bugs, the original repro passes.
- Tests, typecheck and lint pass.
- Request/response shapes and enum values match across repos.
- **Design** (when Figma links cover changed UI): compare the Figma screenshot and values against a screenshot of the same screen and state. Look at layout, spacing, typography, colors (tokens, not hard-coded values), copy and the states the design shows. List each mismatch with design vs. implemented values. Ignore test-data and font-rendering differences. Save the screenshot pairs to a temp folder.

## 3. Speed

Measure only the touched paths, and compare against the base branch where it's cheap. Report numbers and the tool that produced them.

- **Sentry baseline** (if connected): p50/p95 and errors for the changed endpoints or screens.
- **Backend:** `curl -w '%{time_total}'` about 20 times after a warm-up for p50/p95. Use `go tool pprof` on `:6060` (profile, heap) when a hot path changed. Run `EXPLAIN (ANALYZE, BUFFERS)` on new or changed queries. Use `pg_stat_statements` call counts to catch N+1s.
- **Web:** in-app browser `trace.start` → `reload` / interaction → `trace.stop` → `trace.analyze` for long tasks and layout work. Use `cpu.*` for hot JS, `heap.snapshot` + `heap.compare` if a leak is plausible, `network.list` for duplicate or serial fetches, and `lighthouse` for accessibility and best practices.
- **Mobile:** run the same flow on base and branch. Use `xcrun xctrace record --template 'Time Profiler'` for CPU, and treat the numbers as relative.
- **Code:** look for unbounded loops or queries, missing pagination, per-item work that could be done once, and missing indexes in new migrations.

## 4. Code review

Give each background subagent the diff, the intent and the `AGENTS.md`. Ask it to find:
- **Correctness:** bugs, unhandled errors, races, auth/RLS gaps, missing validation.
- **Dead code:** unused code, exports, files, flags or columns, and leftover debug output. Confirm with `grep`.
- **Bad code:** duplication of existing helpers, needless abstraction, style that doesn't match the codebase, comments that restate the code.
- **Tests:** changed behavior that isn't tested.

Also run `go vet` / `staticcheck` / `deadcode ./...` or `npx knip` where available. Check every finding against the code yourself, and drop what you can't confirm.

## 5. Report

```
## Verify: <what> (<repos>)
**Verdict:** ready / needs fixes / blocked
### Ran        — what ran, what couldn't and why
### Works      — pass/fail per behavior, with evidence
### Design     — per frame, with screenshot paths (omit without Figma)
### Speed      — numbers, base vs. branch
### Findings
| # | Severity | Repo | file:line | Issue | Fix |
```

Severity levels:
- **blocker:** wrong behavior, data loss, security.
- **should fix:** edge-case bugs, regressions, added dead code, visible design mismatches.
- **nit:** style.

When called from `work`, fix the blockers and should-fixes, then rerun the affected checks. When called directly, ask which findings to fix.
