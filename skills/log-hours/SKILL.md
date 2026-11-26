---
name: log-hours
description: >
  Log work hours / time into the Airtable "Tasks time log" form. Use when the user runs /log-hours
  or says "log hours", "log my time", "log time", "time log", or describes time spent, e.g.
  "from 7 to 10 I was working on CLDA-9210, 10-12 meeting with client X". Parses entries, enriches
  ticket IDs from Linear, finds the Airtable Project and Project task, confirms with the user,
  then submits the form through the browse tools.
---

# Log hours

Form URL: https://airtable.com/appkhjg1wM9xF8oXO/pagdJA233SyIPHrsY/form ("Tasks time log").

Use Code Mode `execute`. Linear tools are `tools.linear.*`, browser tools are `tools.browse.*`. Compose several browse steps in one script where practical. Refs (e12) go stale after any page change, so re-snapshot before using them, and verify with a fresh read (`snapshot`/`screenshot`), not just because a click returned.

## 1. Parse the input

Split the user's text into entries: date, start, end, what was done.
- Date defaults to today. Understand "yesterday", weekdays (most recent past one), and explicit dates. Output dd/mm/yyyy.
- Times are 24h. Read "7 to 10" as 07:00–10:00 and "1-3" as 13:00–15:00 (working hours). If still ambiguous (e.g. "5 to 8"), ask.
- Ask if a time range, date, or description is missing or unclear. Do not guess.

## 2. Enrich ticket entries from Linear

For every ticket ID (pattern `[A-Z]+-\d+`, e.g. CLDA-1234), call `tools.linear.get_issue({ id: "CLDA-1234" })` to get the title and `url`.

The stored Notes value for a ticket entry is the ticket ID linked to the Linear `url`, followed by `: <what was done>`. Rendered, it shows a blue underlined "CLDA-9120" link, then ": description".

Use markdown `[CLDA-9120](https://linear.app/thecalda/issue/CLDA-9120/2611-testing-sesh): <what was done>` ONLY in the confirmation table in step 4. Never type markdown into the form: the Notes field is a rich-text editor and keeps it as literal text. Step 5 describes how to create the real link.

Use the `url` returned by Linear verbatim. Write the description clean, concise, past tense, typos fixed, no filler. If the user gave little detail, use the ticket title/context to make it meaningful, without inventing work. Non-ticket entries get just the clean description.

## 3. Find Project and Project task in Airtable

1. Open the form in a new tab: `navigate` with the URL and no `tab`; keep the returned tab id. If browse reports no browser connected, run `status`, pass its `nextStep` to the user, and wait. If Airtable needs login, call `handoff` with the tab and wait.
2. `snapshot`. Click "Add project to Project field" (pick Project first; Project tasks is likely filtered by it). A dialog opens with a "Search" combobox.
3. The option list is NOT in the a11y snapshot. Type keywords (from the ticket, its Linear project, or the user's text) into the Search combobox, then read the options with `screenshot` and/or `eval` over the dialog DOM (e.g. `[role=dialog]` text/children). If the dialog closes unexpectedly, reopen it.
4. Repeat for "Add project to Project tasks field".
5. Pick the best match. If unsure, list the candidates and ask the user. Never invent a Project or Project task name that is not in the pickers.
6. Do not submit while researching. Reset the form (or reload) afterwards.

## 4. Confirm before anything is submitted

Show one table, one row per entry:

| Date | Start–End | Hours | Project | Project task | Notes |
|---|---|---|---|---|---|

Hours are decimal (e.g. 3h, 1.5h). Add a line `Total: Xh`. Then STOP and wait for explicit confirmation. Apply any edits and re-show the table until confirmed. Submit nothing before confirmation.

## 5. Submit (after confirmation)

For each entry, in order:
1. Load the form fresh (`navigate` to the URL again, or "Submit another response").
2. `snapshot`. Airtable keeps a form draft between visits, so fields may already contain text. Check that every field is empty before filling. If Notes is not empty, focus `.ql-editor` and run `document.execCommand('selectAll'); document.execCommand('delete')` via `eval`. Click "Clear form" for the rest, then re-snapshot.
3. Fill. All fields are required:
   - Team member: click "Add team to Team member field", search, pick "Tim Rekelj".
   - Project and Project task via their pickers (search, read options, click the exact match).
   - Start time: combobox "Start time" (date, dd/mm/yyyy) and textbox "Time" (hh:mm, 24h).
   - End time: combobox "End time" (date dd/mm/yyyy) and textbox "Time" (hh:mm).
   - Notes: rich-text editor (`.ql-editor` contenteditable). Typed markdown stays literal and synthetic paste events are ignored, so for ticket entries create the link like this:
     1. `type` into textbox "Notes" the plain text `CLDA-9120: <description>` (ticket ID, colon, space, description).
     2. Select only the ticket ID with `eval`: `(()=>{const t=document.querySelector('.ql-editor p').firstChild; const r=document.createRange(); r.setStart(t,0); r.setEnd(t,'CLDA-9120'.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString()})()`. The returned value must equal the ticket ID.
     3. `snapshot` with `within: "body"`. The editor toolbar appears outside <main> (Paragraph, Numbered list, Checklist, Bulleted list, Bold, Italic, Strikethrough, Code, Link). Click button "Link".
     4. A textbox "Link" appears. `type` the Linear issue url into it and `press` Enter.
     5. Verify with `eval` `document.querySelector('.ql-editor').innerHTML`. It must contain `<a href="<linear url>"...>CLDA-9120</a>: <description>`.
     Non-ticket entries: just `type` the plain description.
4. Verify every filled value via a fresh `snapshot`/`screenshot` (pickers show the chosen record, dates and times match, Notes link and text are exact).
5. Click "Submit" and confirm the success message. Do not click "Clear form" unless resetting.

On any failure, stop immediately and report which entries were submitted and which were not. Never resubmit an entry that already went through (no duplicates); if unsure whether a submit succeeded, ask the user to check.

## 6. Report

List submitted entries (date, time range, project, task) and any not submitted. Close the tabs you opened (`tabs` with action `close`).
