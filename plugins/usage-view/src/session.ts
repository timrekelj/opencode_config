import { addRow, dayFormatter, emptyTokens, modelBucket, SUBTREE, toRow, USAGE_COLUMNS, type Database } from "./ledger"
import type { RetainedModel, SessionRange, SessionResult, SessionToolUsage, TokenTotals } from "./types"

const DAY_MS = 24 * 60 * 60 * 1000

const previousDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)

/** Nearest-rank median. */
const median = (values: number[]) => {
  if (values.length === 0) return undefined
  values.sort((a, b) => a - b)
  return values[Math.ceil(values.length / 2) - 1]
}

function usageOf(db: Database, root: string, range: { from: number; to: number }, dayOf: (time: number) => string) {
  const rows = db.all(
    `${SUBTREE}
     SELECT ${USAGE_COLUMNS}
     FROM session_message m
     WHERE m.type = 'assistant'
       AND json_extract(m.data, '$.tokens') IS NOT NULL
       AND m.session_id IN (SELECT id FROM tree)
       AND m.time_created >= ? AND m.time_created < ?
     GROUP BY slot, provider, model`,
    root,
    range.from,
    range.to,
  )
  const total = { steps: 0, cost: 0, tokens: emptyTokens() as TokenTotals }
  const byModel = new Map<string, RetainedModel>()
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const row = toRow(r)
    if (!row) continue
    addRow(total, row)
    addRow(modelBucket(byModel, row), row)
    const date = dayOf(row[0])
    byDay.set(date, (byDay.get(date) ?? 0) + row[3])
  }
  return { ...total, models: [...byModel.values()], byDay }
}

function toolsOf(db: Database, root: string, range: { from: number; to: number }) {
  const rows = db.all(
    `${SUBTREE}
     SELECT json_extract(c.value, '$.name') AS name,
       json_extract(c.value, '$.state.status') AS status,
       json_extract(c.value, '$.time.completed') - json_extract(c.value, '$.time.ran') AS duration
     FROM session_message m, json_each(m.data, '$.content') c
     WHERE m.type = 'assistant'
       AND m.session_id IN (SELECT id FROM tree)
       AND m.time_created >= ? AND m.time_created < ?
       AND json_extract(c.value, '$.type') = 'tool'`,
    root,
    range.from,
    range.to,
  )
  const byName = new Map<string, SessionToolUsage & { durations: number[] }>()
  const totals = { calls: 0, succeeded: 0, failed: 0, unfinished: 0 }
  for (const r of rows) {
    const name = String(r.name)
    let tool = byName.get(name)
    if (!tool) {
      tool = { name, calls: 0, succeeded: 0, failed: 0, unfinished: 0, durations: [] }
      byName.set(name, tool)
    }
    tool.calls++
    totals.calls++
    if (r.status === "completed") {
      tool.succeeded++
      totals.succeeded++
    } else if (r.status === "error") {
      tool.failed++
      totals.failed++
    } else {
      tool.unfinished++
      totals.unfinished++
    }
    if ((r.status === "completed" || r.status === "error") && typeof r.duration === "number") tool.durations.push(r.duration)
  }
  const usage = [...byName.values()]
    .map(({ durations, ...tool }): SessionToolUsage => ({ ...tool, durationP50: median(durations) }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
  return { totals, usage }
}

/**
 * `session.stats`-style usage of one session and all its subagents (recursively), per time range `[from, to)`.
 * `sessions` and `subagents` count the sessions in the tree with a message in the range, so an empty range shows 0.
 * `streak` is the run of active local days ending on the range's last day, or the day before when that one is still
 * empty. Live data only: sessions that were deleted are gone from the database.
 */
export function sessionUsage(
  db: Database,
  input: { sessionID: string; ranges: { from?: number; to: number }[]; timezone?: string; tools?: boolean },
): SessionResult {
  const dayOf = dayFormatter(input.timezone)
  const first = db.all(
    `${SUBTREE} SELECT min(time_created) AS earliest FROM session_message WHERE session_id IN (SELECT id FROM tree)`,
    input.sessionID,
  )[0]

  const ranges = input.ranges.map((r): SessionRange => {
    const range = { from: r.from ?? 0, to: r.to }
    const usage = usageOf(db, input.sessionID, range, dayOf)
    const counts = db.all(
      `${SUBTREE}
       SELECT m.session_id AS id, sum(m.type = 'user') AS prompts
       FROM session_message m
       WHERE m.session_id IN (SELECT id FROM tree) AND m.time_created >= ? AND m.time_created < ?
       GROUP BY m.session_id`,
      input.sessionID,
      range.from,
      range.to,
    )
    const activity = [...usage.byDay]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, steps]) => ({ date, steps }))
    let streak = 0
    let day = dayOf(range.to - 1)
    if (!usage.byDay.has(day)) day = previousDay(day)
    for (; usage.byDay.has(day); day = previousDay(day)) streak++
    const { byDay: _byDay, ...rest } = usage
    return {
      range,
      sessions: counts.some((c) => c.id === input.sessionID) ? 1 : 0,
      subagents: counts.filter((c) => c.id !== input.sessionID).length,
      prompts: counts.reduce((sum, c) => sum + Number(c.prompts), 0),
      ...rest,
      activeDays: activity.length,
      streak,
      activity,
      tools: input.tools ? toolsOf(db, input.sessionID, range) : undefined,
    }
  })
  return { earliest: typeof first?.earliest === "number" ? first.earliest : undefined, ranges }
}
