---
name: pitcrew-review
description: Review finished work by actually running it (backend, web, mobile simulator), checking it works and how fast, and reviewing the code for bugs, dead code and poor quality. Use after implementing or fixing something, or to review a branch or PR.
---

# pitcrew-review

Review a change the way a senior engineer would: run it, try it, measure it, then read the code. Report with evidence.

## 0. Scope

1. Work out what's being reviewed: the given PR / branch, otherwise the current branch. Include sibling repos (from `AGENTS.md`) that have related changes on a branch.
2. **Base branch:** `development` if the repo has it, otherwise `staging`.
3. Per repo, collect `git diff origin/<base>...HEAD` and the intent: the Linear ticket, PR description, or what the user said. Review against the intent, not just the diff. Collect any Figma links from those too.
4. Read each repo's `AGENTS.md` for how to run, test and seed it.
5. **Clarify before starting.** Don't assume the intent or the scope. If anything is unclear — missing or vague intent (no ticket or PR description), expected behavior, which repos, flows or screens are in scope, what to focus on, which Figma frames apply, what local setup or seed data to use — ask all of it at once, in one numbered message with your recommended answers, and wait before running anything. Don't ask what you can find out from the code, the ticket or `AGENTS.md`. When called from `pitcrew-drive`, don't re-ask what was already settled there.
6. **Start the code-quality review now** (step 4) as background subagents, one per repo, so it runs while you run and measure the change. Use the `general` subagent for this. Collect their results at step 4.

## 1. Run it

Start only what the change needs, locally. Never point anything at a staging or production database or service. Stop what you started when you're done.

| Repo type | Run | Exercise the change |
|---|---|---|
| **Backend** (Go + Supabase) | Local Supabase (`supabase start`, reset/seed per `AGENTS.md`), then the API (`air`, `go run`, or docker compose) with `PPROF_ADDR=127.0.0.1:6060` if the repo supports it (see its `AGENTS.md`). Integration tests per `AGENTS.md`. | Call the changed endpoints with `curl` or the Bruno collection: happy path, bad input, wrong user / no auth, empty data. Check responses, status codes, and the rows written. |
| **Web** (Next.js) | `npm run dev` against the local backend. Use `e2e` tests if present. | Open the changed pages with the **Chrome DevTools MCP** (`new_page` / `navigate_page`, `take_snapshot`, `click` / `fill`). Click through the flow; check `list_console_messages`, failed requests in `list_network_requests`, and server logs; check loading, empty and error states. |
| **Mobile** (Expo) | `npm run check`, then the app on the iOS simulator (`npx expo run:ios` or the existing dev build) against the local backend. | Run the relevant `.maestro/` flows if Maestro is installed; otherwise drive it and take screenshots (`xcrun simctl io booted screenshot`). Check Metro logs for errors and warnings. |

If something can't run locally (missing env vars, Docker not running, a third-party service), say exactly what's missing and continue with what can run. Never fake a result.

## 2. Does it work?

- Does the behavior match the intent, including edge cases the ticket implies?
- For bugs: does the original repro now pass?
- Do existing tests and checks pass (tests, typecheck, lint, format)?
- Across repos: do request/response shapes, enum/option values and error handling match on both sides?

### Matches the design? (when there are Figma links and the change touches UI)

For each Figma frame that covers a changed screen:

1. Get the design: a screenshot of the frame (Figma `get_screenshot`) plus its design context and variables (`get_design_context`, `get_variable_defs`) for exact values. Follow the Figma MCP's own instructions.
2. Get the implementation at the same size and state:
   - **Web:** Chrome DevTools MCP — `resize_page` to the frame's width and height, navigate to the screen, put it in the same state (data, hover, open menu…), `take_screenshot`. Use `get_css_styles` to read real values where something looks off.
   - **Mobile:** a simulator close to the frame's device size, drive to the screen (Maestro flow if there is one), `xcrun simctl io booted screenshot`.
3. Compare them side by side, section by section:
   - layout and alignment, spacing and sizes
   - typography (family, size, weight, line height)
   - colors, borders, radii, shadows — and whether they use the repo's tokens instead of hard-coded values
   - copy, icons and images
   - states the design shows (empty, loading, error, disabled, variants) and that they exist in code
4. Every mismatch becomes a finding with both screenshots referenced and the exact values (design vs. implemented). Ignore differences caused only by test data or font rendering. If a mismatch looks intentional (a platform convention, an existing component that differs slightly), call it out as a question rather than a defect.

Save the screenshot pairs to a temp folder and list their paths in the report.

## 3. How fast is it?

Measure the paths the change touched — don't profile the whole app. Where it's cheap, run the same measurement on the base branch too, so you can call it a regression or not. Use the tools below; if one isn't available, say which and move on.

**Production baseline (Sentry).** Before measuring locally, look up the changed endpoints / screens in Sentry: `search_traces` for their p50/p95 duration and slowest spans, `search_profiles` for hot functions, `search_issues` for current errors. This tells you what's already slow in real use and what to watch for. Skip if the Sentry tools aren't connected.

**Backend (Go + Postgres)**
- **Latency:** `curl -s -o /dev/null -w '%{time_total}\n'` against each changed endpoint, ~20 runs after a warm-up; report p50/p95.
- **CPU / memory / stacks (pprof):** with the API on `PPROF_ADDR`, run the endpoint in a loop while capturing, from `app/`:
  - `go tool pprof -top -cum 'http://127.0.0.1:6060/debug/pprof/profile?seconds=15'` — where time goes
  - `go tool pprof -top -sample_index=alloc_space http://127.0.0.1:6060/debug/pprof/heap` — allocations
  - `curl -s 'http://127.0.0.1:6060/debug/pprof/goroutine?debug=2'` — goroutine stacks; look for leaks or blocking
  - For a pure function: `go test -run '^$' -bench . -benchmem -cpuprofile /tmp/cpu.out ./<pkg>` then `go tool pprof -top /tmp/cpu.out`
- **SQL (psql against local Supabase):** for every new or changed query, `EXPLAIN (ANALYZE, BUFFERS)` with realistic parameters. Flag sequential scans on large tables, missing indexes for new filters/joins/sorts, and row-estimate misses. To catch N+1s, reset `pg_stat_statements` (`select pg_stat_statements_reset();`), hit the endpoint once, then read `select calls, mean_exec_time, query from pg_stat_statements order by calls desc limit 20;`.

**Web (Chrome DevTools MCP)**
- `performance_start_trace` with reload on the changed page (and again while doing the changed interaction), `performance_stop_trace`, then `performance_analyze_insight` on the insights it reports (LCP breakdown, render-blocking, long tasks, layout shifts).
- `lighthouse_audit` on the changed page for a performance / accessibility / best-practices score.
- `list_network_requests`: count, size and waterfall of requests the page makes; flag duplicate or sequential fetches that could be parallel.
- `take_heapsnapshot` before and after repeating the interaction a few times if a leak is plausible.
- `next build` output: route bundle size versus base.

**Mobile (iOS simulator)**
- Drive the changed flow the same way each time with its `.maestro/` flow (`maestro test <flow>`) when Maestro is installed.
- CPU profile of the app while the flow runs: get the booted simulator's UDID (`xcrun simctl list devices booted`), then `xcrun xctrace record --template 'Time Profiler' --device <UDID> --attach <app process name> --time-limit 20s --output /tmp/app.trace`, then `xcrun xctrace export --input /tmp/app.trace --toc` and export the time-profile table to read the heaviest stacks.
- Metro / app logs for repeated renders or effects firing in a loop; count network calls the screen makes on mount.
- Treat simulator numbers as relative (base vs. branch), not absolute device performance.

**Code-level (always)**
Unbounded loops or queries, missing pagination or limits, per-item work that could be done once, fetching data that isn't used, missing indexes in new migrations.

Report numbers, not impressions, and say which tool produced each one. If you couldn't measure something, say what was missing.

## 4. Code quality

This runs in the background subagents started in step 0 — one per repo, each given the diff, the intent and the repo's `AGENTS.md`, not your own conclusions. Use the `general` subagent for this. Ask each to find:

- **Correctness:** bugs, unhandled errors, race conditions, auth/RLS gaps, missing input validation.
- **Dead code:** unused functions, exports, components, files, flags, env vars, DB columns; code made unreachable by this change; leftover debug logs or commented-out code. Confirm with `grep` before reporting.
- **Bad code:** duplication of something that already exists in the repo, needless abstraction, unclear naming, functions doing too much, code that doesn't match the surrounding style, comments that only restate the code.
- **Tests:** missing tests for the changed behavior, tests that don't actually assert it.

Also run the repo's own linters, and these when available: `go vet` / `staticcheck` / `deadcode ./...` (Go), `npx knip` (TS unused files and exports).

When they finish, merge their findings with anything you noticed while running the change. Check every finding against the code yourself before reporting it. Drop anything you can't confirm.

## 5. Report

```
## Review: <what> (<repos>)

**Verdict:** ready / needs fixes / blocked

### Ran
<what was started and exercised, per repo; what couldn't run and why>

### Works
<pass/fail per behavior, with evidence>

### Design
<per Figma frame: matches / mismatches, with screenshot paths; omit without Figma links>

### Performance
<numbers, base vs. branch where measured; regressions flagged>

### Findings
| # | Severity | Repo | file:line | Issue | Fix |
|---|---|---|---|---|---|
```

Severity: **blocker** (wrong behavior, data loss, security), **should fix** (bugs in edge cases, real perf regressions, dead code added by this change, visible mismatches with the Figma design), **nit** (style, naming).

## 6. Fixing

- Called from `pitcrew-drive`: fix blockers and should-fixes, then re-run the affected parts of steps 1–4. Mention nits you skipped.
- Called directly: report, then ask which findings to fix.
