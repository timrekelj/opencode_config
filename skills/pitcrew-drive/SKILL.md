---
name: pitcrew-drive
description: Take an instruction or a Linear ticket, decide whether it is a bug, feature, change or question, and drive it end to end — reproduce, build, verify, review and open PRs to development (or staging) in every repo touched, keeping the ticket updated.
metadata:
  opencode/autoinvoke: false
---

# pitcrew-drive

You get one input: free-form instructions, a Linear ticket (id like `ABC-123` or a URL), or both. Drive it to a finished, reviewed PR — or, for a question, to a clear answer.

## 0. Load context

1. If the input names a Linear ticket, fetch it (title, description, comments, attachments) with the Linear tools. If Linear isn't connected, ask the user to paste the ticket.
2. Read the current repo's `AGENTS.md` (or `CLAUDE.md`). It holds the commands, how to run tests, and the **sibling repos** (backend / web / mobile). Read a sibling's `AGENTS.md` only when the work reaches into it.
3. **Figma:** collect every Figma link from the input and the ticket (description, comments, attachments). For each, use the Figma tools (follow the Figma MCP's own instructions) to get a screenshot of the frame and its design context — layout, spacing, typography, colors, variables, copy, states. These designs are part of the spec. If a link points at a whole page or file rather than a frame, list the frames and ask which ones apply. If the Figma tools aren't connected, say so and continue without them.
4. Look at the relevant code before deciding anything. If the ticket is already partly or fully done in code, say so and stop to confirm what's left.
5. **Broad searches go to a subagent.** When finding something means reading across many files, git history or several repos (where is X computed, who calls it, when did it change), hand that search to the `explore` subagent with a specific question and use its conclusion. Keep your own context for the plan, the fix and the repro loop. Look up a single known file or symbol yourself.
6. **Base branch:** `development` if the repo has it, otherwise `staging`. If neither exists, ask. "Base branch" below means this.

## 1. Classify

Pick exactly one and state it in one line, with the reason:

| Type | When |
|---|---|
| **bug** | Existing behavior is wrong: an error, a crash, wrong data, wrong UI. |
| **feature** | New or changed behavior the user asked for. |
| **change** | No behavior change for users: refactor, cleanup, config, script, data/backfill. |
| **question** | The user wants to understand something. No code changes. |

If the type itself is unclear, add that to the questions in step 2.

## 2. Clarify before starting

Don't assume anything. Before branching, writing code or investigating, list everything you'd otherwise have to guess and that the input, the ticket, the designs, `AGENTS.md` and the code don't answer: scope and what's out of scope, which repos, the expected behavior, edge cases and error handling, UI states the designs don't show, data or migration impact, and what "done" looks like.

- Ask them **all at once**, in one message, numbered, each with your recommended answer, and wait for the replies. Don't trickle questions out one by one.
- Don't ask what you can find out yourself from the code, git history or the ticket — look it up instead.
- If nothing is open, say so in one line and continue.
- If a new question comes up mid-work that changes what you'd build, stop and ask it instead of picking an answer.

Then create a todo list from the steps of that type's route below.

## 3. Branch

For bug / feature / change, in every repo you will edit:
- Start from the up-to-date base branch (`git fetch`, then branch from `origin/<base>`).
- Branch name: `fix/…`, `feat/…` or `chore/…`, plus the Linear id if there is one (`fix/abc-123-short-name`).
- If you're already on a feature branch for this work, stay on it.

## 4. Routes

### bug

1. **Reproduce locally first.** Prefer, in order: a failing automated test → a script / curl / SQL query → running the app (simulator, browser). Write down the exact repro steps and the observed vs. expected result.
2. If it **can't** be reproduced locally (needs prod data, a third party, a device you don't have), say why, then find the root cause from code, logs and Sentry. Continue, but mark the fix as **not verified by repro** in the summary and PR.
3. Find the **root cause**, not just the line that throws. Explain it in two or three sentences.
4. Fix it.
5. **Verify with the same repro.** If it still fails, go back to 3. Loop until the repro passes. If you're 5 attempts in without progress, stop and report what you've learned instead of guessing further.
6. If the repro was manual, turn it into an automated test where the repo has a test setup for that area.
7. Run the repo's checks (tests, typecheck, lint — from `AGENTS.md`).
8. → **Finish**.

### feature

1. Write a short plan: what changes in which repo, data shape / API contract first, then the code. For anything touching the database (schema, migration, trigger, RLS, backfill), show the plan and wait for the user's OK before writing it.
2. If the work spans repos, do the backend/API first, then clients against it. Keep contracts and shared values in sync across repos.
3. Build it. Match the surrounding code; don't add abstractions or comments the codebase doesn't use. With Figma designs, build to them using the repo's existing components and design tokens (map Figma variables to the existing tokens rather than hard-coding values), and cover the states the designs show (empty, loading, error, variants).
4. Prove it works: tests where the repo has them, plus actually running the changed path (request, script, simulator, browser) when it's cheap to do.
5. Run the repo's checks.
6. → **Finish**.

### change

1. State what changes and what must stay the same.
2. Do it. Scripts that touch data must be safe to re-run and support `-dry-run`; run the dry run first and show the output.
3. Show the behavior is unchanged: the existing tests pass, plus anything specific to what you touched.
4. Run the repo's checks.
5. → **Finish**.

### question

Investigate (code, git history, Linear, Sentry, DB as needed) and answer directly, pointing at `file:line`. Say what you verified versus what you're inferring. No branch, no PR.

## 5. Finish (bug / feature / change)

1. **Review.** Load the `pitcrew-review` skill and follow it on every touched repo, passing along any Figma links. It runs the change, measures it and reviews the code; fix its blockers and should-fixes and re-run the affected checks. Note in the summary anything you chose not to fix and why.
2. **Ship.** Load the `pitcrew-ship` skill to commit, push and open a PR to the base branch in **every repo touched**, cross-linked and linked to the Linear ticket.
3. **Summary** to the user, short:
   - type and root cause (bugs) or what was built
   - how it was verified (and what wasn't)
   - PR links, one per repo
   - anything left for the user to do (run a migration, backfill, set an env var)

## Keeping the Linear ticket updated

Only when a ticket was given. Keep comments short and factual — they're for the team, not a log of your steps.

| When | Update |
|---|---|
| Start of work (after classifying) | Assign to the user if unassigned, move to **In Progress**, comment: type + short plan. |
| Bug reproduced (or not) | Comment: repro steps and result, or why it can't be reproduced locally. |
| Root cause found | Comment: the root cause in two or three sentences. |
| Blocked or waiting on the user | Comment what's blocking. |
| PRs opened | Comment: PR links per repo + how it was verified; move to **In Review**. |
| Question answered | Comment the answer if the ticket was a question. |

Use the team's actual status names (look them up); if a status doesn't exist, skip that move. If Linear tools aren't available, skip updates and tell the user at the end.

## Rules

- Never fill a gap with an assumption: ask (see step 2).
- Don't edit a sibling repo unless the task needs it; when it does, say so before you start there.
- Never push to `development`, `staging`, `master`/`main` or `production` directly, and never run anything against a non-local database without asking.
- Prefer deleting or reusing code over adding more.
- Use the `explore` subagent for broad searches across files, git history, or multiple repos — keep your own context focused on the plan, fix, and repro loop.
