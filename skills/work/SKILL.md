---
name: work
description: Take an instruction or a Linear ticket, classify it (bug, feature, change, question) and drive it to a verified, shipped PR in every repo it touches, keeping the ticket updated.
metadata:
  opencode/autoinvoke: false
---

# work

Input: free-form instructions, a Linear ticket (`ABC-123` or URL), or both. Finish with reviewed PRs, or for a question, a clear answer.

**Base branch:** `development` if the repo has it, else `staging`, else ask.

## 1. Context

- Fetch the Linear ticket (description, comments, attachments). If Linear isn't connected, ask for it to be pasted.
- Read the repo's `AGENTS.md`: commands, tests, sibling repos (backend / web / mobile). Read a sibling's only when the work reaches it.
- For every Figma link, get a screenshot and the design context of the frame. The design is part of the spec. If a link is a whole page, ask which frames apply.
- Read the relevant code. If the work is already done, say so and confirm what's left.
- Hand broad searches (many files, git history, several repos) to the `explore` subagent.

## 2. Classify and clarify

State the type in one line: **bug** (existing behavior is wrong), **feature** (new behavior), **change** (no user-visible change: refactor, config, script, backfill) or **question**.

List everything you'd otherwise have to guess: scope, repos, expected behavior, edge cases, states the design doesn't show, data impact, what "done" means. Ask it all in one numbered message with your recommended answers, and wait. Don't ask what the code, ticket or history answers. If a new question comes up mid-work that changes what you'd build, stop and ask.

Then make a todo list from the route below.

## 3. Route

Branch from `origin/<base>` in each repo you edit: `fix/…`, `feat/…` or `chore/…`, plus the Linear id. Stay on an existing branch for this work.

- **bug:** Reproduce locally first (failing test, then script/curl/SQL, then the running app). Find the root cause and explain it in two or three sentences. Fix, then rerun the same repro until it passes; after 5 attempts without progress, stop and report. Turn a manual repro into a test where the repo has tests. If it can't be reproduced locally, say why and mark the fix **not verified by repro**.
- **feature:** Write a short plan (data shape / API first). Show any database change (schema, migration, RLS, backfill) and wait for an OK. Do the backend before the clients. Build to the Figma design using the repo's existing components and tokens, covering empty, loading and error states.
- **change:** State what must stay the same. Data scripts must be re-runnable and support `-dry-run`, so run the dry run first and show the output. The existing tests must still pass.
- **question:** Answer with `file:line` references, separating what you verified from what you infer. No branch, no PR.

Run the repo's checks (tests, typecheck, lint) before finishing.

## 4. Finish

1. Load `verify` and fix its blockers and should-fixes.
2. Load `ship`.
3. Summary: the type and root cause or what was built, how it was verified (and what wasn't), PR links, and anything left for the user (migrations, env vars).

## Linear

Only when a ticket was given. Keep comments short and factual.
- Start: assign if unassigned, move to **In Progress**, comment the type and plan.
- Bugs: comment the repro result and the root cause.
- Blocked: comment what's blocking.
- PRs open: `ship` comments the links and moves the ticket to **In Review**.

Use the team's real status names and skip any that don't exist.

## Rules

- Never push to `development`, `staging`, `main`/`master` or `production`, and never touch a non-local database without asking.
- Say so before editing a sibling repo.
- Prefer deleting or reusing code over adding more.
