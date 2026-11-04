import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import type { DailyResult, RetainedModel, RetainedRange, RetainedResult, TokenTotals } from "./types"

/** Usage is kept in quarter-hour slots so it lines up with local hours in every time zone. */
const SLOT_MS = 15 * 60 * 1000
/** Rescan messages updated a little before the last sync, in case a write raced it. */
const SLACK_MS = 5 * 60 * 1000
const MIN_INTERVAL_MS = 2000
const BACKSTOP_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_RETENTION_DAYS = 92
const PREFIX = "session/"

/** slot, providerID, modelID, steps, input, output, reasoning, cache read, cache write, cost */
type Row = [number, string, string, number, number, number, number, number, number, number]

interface Entry {
  projectID: string
  parentID: string | null
  /** Project of the session's root session, when it differs. Subagents can land in another project than their parent. */
  rootProjectID?: string
  deletedAt: number | null
  rows: Row[]
}

interface SessionRef {
  parent: string | null
  project: string
}

interface Storage {
  get(key: string): Promise<unknown>
  set(key: string, value: any): Promise<void>
  remove(key: string): Promise<void>
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    entries: readonly { key: string; value: unknown }[]
    next?: string
  }>
}

interface Database {
  all(sql: string, ...params: unknown[]): any[]
  close(): void
}

// Not opened read-only: a read-only connection cannot open a WAL database whose -shm file is missing.
// The ledger only ever runs SELECTs.
async function openDatabase(path: string): Promise<Database> {
  let bun: any
  try {
    bun = await import("bun:sqlite" as string)
  } catch {}
  if (bun) {
    const db = new bun.Database(path, { readwrite: true, create: false })
    return { all: (sql, ...params) => db.query(sql).all(...params), close: () => db.close() }
  }
  const { DatabaseSync } = await import("node:sqlite" as string)
  const db = new DatabaseSync(path)
  return { all: (sql, ...params) => db.prepare(sql).all(...params), close: () => db.close() }
}

export function defaultDatabasePath(channel?: string): string {
  const xdg = process.env.XDG_DATA_HOME?.trim()
  const dir =
    process.env.OPENCODE_DATA_DIR?.split(",")[0]?.trim() ||
    join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share"), "opencode")
  const main = join(dir, "opencode.db")
  const named = channel ? join(dir, `opencode-${channel}.db`) : undefined
  return existsSync(main) || !named || !existsSync(named) ? main : named
}

const emptyTokens = (): TokenTotals => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

function addRow(target: { steps: number; cost: number; tokens: TokenTotals }, row: Row) {
  target.steps += row[3]
  target.tokens.input += row[4]
  target.tokens.output += row[5]
  target.tokens.reasoning += row[6]
  target.tokens.cache.read += row[7]
  target.tokens.cache.write += row[8]
  target.cost += row[9]
}

/** Per-model usage columns over `session_message m`, to group by slot, provider and model. */
const USAGE_COLUMNS = `(m.time_created / ${SLOT_MS}) * ${SLOT_MS} AS slot,
  json_extract(m.data, '$.model.providerID') AS provider,
  json_extract(m.data, '$.model.id') AS model,
  count(*) AS steps,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) AS input,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) AS output,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) AS reasoning,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) AS cache_read,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.write'), 0)) AS cache_write,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) AS cost`

/** A result row of USAGE_COLUMNS as a Row, or undefined when the message has no model. */
function toRow(r: any): Row | undefined {
  if (typeof r.provider !== "string" || typeof r.model !== "string") return undefined
  return [
    Number(r.slot),
    r.provider,
    r.model,
    Number(r.steps),
    Number(r.input),
    Number(r.output),
    Number(r.reasoning),
    Number(r.cache_read),
    Number(r.cache_write),
    Number(r.cost),
  ]
}

/** The row's model in `models`, added empty if missing. */
function modelBucket(models: Map<string, RetainedModel>, row: Row): RetainedModel {
  const key = `${row[1]}/${row[2]}`
  let model = models.get(key)
  if (!model) {
    model = { model: { providerID: row[1], id: row[2] }, steps: 0, cost: 0, tokens: emptyTokens() }
    models.set(key, model)
  }
  return model
}

const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Entry).rows) &&
  typeof (value as Entry).projectID === "string"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Maps a time to its `YYYY-MM-DD` in the given zone (or the server's own when unknown), cached per slot. */
function dayFormatter(timezone: string | undefined): (time: number) => string {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" }
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone })
  } catch {
    format = new Intl.DateTimeFormat("en-US", options)
  }
  const cache = new Map<number, string>()
  return (time) => {
    const slot = Math.floor(time / SLOT_MS) * SLOT_MS
    let day = cache.get(slot)
    if (day === undefined) {
      const parts = format.formatToParts(new Date(slot))
      const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
      day = `${part("year")}-${part("month")}-${part("day")}`
      cache.set(slot, day)
    }
    return day
  }
}

/**
 * Keeps a copy of every session's usage in plugin storage, so usage of deleted sessions still counts.
 * Live sessions are read from OpenCode's own stats; only deleted ones, and subagents that stats file under another
 * project than their root session, are answered from here.
 */
export class Ledger {
  private db: Database | undefined
  private syncedAt = 0
  /** Sessions in the ledger that still exist. */
  private live = new Set<string>()
  /** Sessions in the ledger that were deleted, with their usage. */
  private deleted = new Map<string, Entry>()
  /** Parent and project of every session in OpenCode's database, as of the last sync. */
  private sessions = new Map<string, SessionRef>()
  /** adoptedIDs per project, for the current `sessions`. */
  private adopted = new Map<string, string[]>()
  private loaded: Promise<void> | undefined
  private running: Promise<void> | undefined
  private pending = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastRun = 0
  private stopped = false

  constructor(
    private readonly storage: Storage,
    private readonly path: string,
    private readonly log: (message: string) => void = () => {},
    private readonly retentionDays = DEFAULT_RETENTION_DAYS,
  ) {}

  private load() {
    this.loaded ??= (async () => {
      const meta = (await this.storage.get("meta")) as { syncedAt?: unknown } | undefined
      if (typeof meta?.syncedAt === "number") this.syncedAt = meta.syncedAt
      let after: string | undefined
      do {
        const page = await this.storage.scan({ prefix: PREFIX, after, limit: 500 })
        for (const { key, value } of page.entries) {
          if (!isEntry(value)) continue
          const id = key.slice(PREFIX.length)
          if (value.deletedAt === null) this.live.add(id)
          else this.deleted.set(id, value)
        }
        after = page.next
      } while (after)
    })().catch((error) => {
      this.loaded = undefined
      throw error
    })
    return this.loaded
  }

  /** Syncs soon, at most once every couple of seconds. */
  schedule() {
    if (this.stopped) return
    if (this.running) {
      this.pending = true
      return
    }
    if (this.timer) return
    const wait = Math.max(0, this.lastRun + MIN_INTERVAL_MS - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.sync().catch((error) => this.log(`sync failed: ${message(error)}`))
    }, wait)
  }

  sync(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = undefined
      this.lastRun = Date.now()
      if (this.pending) {
        this.pending = false
        this.schedule()
      }
    })
    return this.running
  }

  /** Joins a running sync, or skips one when the last just finished and nothing changed since; otherwise syncs. */
  private fresh(): Promise<void> {
    if (this.running) return this.running
    if (this.db && !this.timer && Date.now() - this.syncedAt < MIN_INTERVAL_MS) return Promise.resolve()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    return this.sync()
  }

  private async run() {
    await this.load()
    if (this.stopped) return
    if (!this.db) {
      if (!existsSync(this.path)) throw new Error(`OpenCode database not found at ${this.path}`)
      this.db = await openDatabase(this.path)
      this.db.all("PRAGMA busy_timeout = 1000")
    }
    const db = this.db
    const startedAt = Date.now()
    const since = this.syncedAt > 0 ? this.syncedAt - SLACK_MS : 0

    // Re-aggregate every session with a message written since the last sync. time_updated has no index, so this
    // scans session_message; OpenCode's database is not ours to add one to.
    const touched: string[] = db
      .all("SELECT DISTINCT session_id AS id FROM session_message WHERE time_updated >= ?", since)
      .map((r) => r.id)
    const rows = db.all(
      `SELECT m.session_id AS session, s.project_id AS project, s.parent_id AS parent, ${USAGE_COLUMNS}
       FROM session_message m JOIN session_v2 s ON s.id = m.session_id
       WHERE m.type = 'assistant'
         AND json_extract(m.data, '$.tokens') IS NOT NULL
         AND m.session_id IN (SELECT value FROM json_each(?))
       GROUP BY m.session_id, slot, provider, model`,
      JSON.stringify(touched),
    )

    this.sessions = new Map(
      db
        .all("SELECT id, parent_id AS parent, project_id AS project FROM session_v2")
        .map((r) => [r.id, { parent: r.parent ?? null, project: String(r.project) }]),
    )
    this.adopted.clear()

    const changed = new Map<string, Entry>()
    for (const r of rows) {
      const row = toRow(r)
      if (!row) continue
      let entry = changed.get(r.session)
      if (!entry) {
        const projectID = String(r.project)
        const root = this.rootProject(r.session)
        entry = { projectID, parentID: r.parent ?? null, deletedAt: null, rows: [] }
        if (root && root !== projectID) entry.rootProjectID = root
        changed.set(r.session, entry)
      }
      entry.rows.push(row)
    }
    for (const [id, entry] of changed) {
      await this.storage.set(PREFIX + id, entry)
      this.live.add(id)
      this.deleted.delete(id)
    }
    // A session whose messages changed but left no usage (e.g. reverted) has nothing to keep.
    for (const id of touched) {
      if (changed.has(id) || !this.live.has(id)) continue
      await this.storage.remove(PREFIX + id)
      this.live.delete(id)
    }

    for (const id of [...this.live]) {
      if (this.sessions.has(id)) continue
      this.live.delete(id)
      const stored = await this.storage.get(PREFIX + id)
      if (!isEntry(stored)) continue
      const entry: Entry = { ...stored, deletedAt: startedAt }
      await this.storage.set(PREFIX + id, entry)
      this.deleted.set(id, entry)
    }

    // Drop deleted usage older than the retention window, like t3code's 92-day cache.
    const cutoff = startedAt - this.retentionDays * DAY_MS
    for (const [id, entry] of this.deleted) {
      const rows = entry.rows.filter((row) => row[0] >= cutoff)
      if (rows.length === entry.rows.length) continue
      if (rows.length === 0) {
        await this.storage.remove(PREFIX + id)
        this.deleted.delete(id)
        continue
      }
      const kept: Entry = { ...entry, rows }
      await this.storage.set(PREFIX + id, kept)
      this.deleted.set(id, kept)
    }

    this.syncedAt = startedAt
    await this.storage.set("meta", { syncedAt: startedAt })
  }

  /** Project of the session at the top of the session's parent chain, if the chain is known. */
  private rootProject(id: string): string | undefined {
    let session = this.sessions.get(id)
    for (let depth = 0; session?.parent && depth < 64; depth++) {
      const parent = this.sessions.get(session.parent)
      if (!parent) break
      session = parent
    }
    return session?.project
  }

  /** A session belongs to a project when it or its root session is filed under it. */
  private static inProject(entry: Entry, project: string | undefined) {
    return !project || entry.projectID === project || entry.rootProjectID === project
  }

  /**
   * Live subagent sessions filed under another project than their root session, when the root is in `project`.
   * OpenCode's stats filter by each session's own project, so they miss these (e.g. a subagent started after `git init`
   * in a directory whose parent session began as a global one).
   */
  private adoptedIDs(project: string): string[] {
    let ids = this.adopted.get(project)
    if (ids) return ids
    ids = []
    for (const [id, session] of this.sessions) {
      if (session.parent && session.project !== project && this.rootProject(id) === project) ids.push(id)
    }
    this.adopted.set(project, ids)
    return ids
  }

  /** Usage rows of live sessions, read from OpenCode's database. */
  private liveEntries(ids: string[]): Map<string, Entry> {
    const entries = new Map<string, Entry>()
    if (ids.length === 0 || !this.db) return entries
    const rows = this.db.all(
      `SELECT m.session_id AS session, ${USAGE_COLUMNS}
       FROM session_message m
       WHERE m.type = 'assistant'
         AND json_extract(m.data, '$.tokens') IS NOT NULL
         AND m.session_id IN (SELECT value FROM json_each(?))
       GROUP BY m.session_id, slot, provider, model`,
      JSON.stringify(ids),
    )
    for (const r of rows) {
      const row = toRow(r)
      if (!row) continue
      let entry = entries.get(r.session)
      if (!entry) {
        const session = this.sessions.get(r.session)
        entry = { projectID: session?.project ?? "", parentID: session?.parent ?? null, deletedAt: null, rows: [] }
        entries.set(r.session, entry)
      }
      entry.rows.push(row)
    }
    return entries
  }

  /**
   * Usage that OpenCode's stats leave out, in each range: deleted sessions, and with a project, live subagent sessions
   * that belong to it through their root session but are filed under another project.
   */
  async retained(input: { ranges: { from?: number; to: number }[]; project?: string }): Promise<RetainedResult> {
    await this.fresh()
    const project = input.project
    const deleted = [...this.deleted].filter(([, entry]) => Ledger.inProject(entry, project))
    const adopted = project ? [...this.liveEntries(this.adoptedIDs(project))] : []
    const a = this.aggregate(input.ranges, deleted)
    const b = this.aggregate(input.ranges, adopted)
    const earliest =
      a.earliest === undefined ? b.earliest : b.earliest === undefined ? a.earliest : Math.min(a.earliest, b.earliest)
    return { earliest, ranges: a.ranges, adopted: adopted.length > 0 ? b.ranges : undefined }
  }

  private aggregate(input: { from?: number; to: number }[], entries: [string, Entry][]) {
    const ranges = input.map(() => ({
      sessions: 0,
      subagents: 0,
      steps: 0,
      cost: 0,
      tokens: emptyTokens(),
      byModel: new Map<string, RetainedModel>(),
      ids: new Set<string>(),
    }))
    let earliest: number | undefined
    for (const [id, entry] of entries) {
      for (const row of entry.rows) {
        earliest = earliest === undefined ? row[0] : Math.min(earliest, row[0])
        input.forEach((range, index) => {
          if ((range.from !== undefined && row[0] < range.from) || row[0] >= range.to) return
          const target = ranges[index]!
          addRow(target, row)
          addRow(modelBucket(target.byModel, row), row)
          if (!target.ids.has(id)) {
            target.ids.add(id)
            if (entry.parentID) target.subagents++
            else target.sessions++
          }
        })
      }
    }
    return {
      earliest,
      ranges: ranges.map(({ byModel, ids: _ids, ...range }): RetainedRange => ({ ...range, models: [...byModel.values()] })),
    }
  }

  /**
   * Usage per local day in `[from, to)`, optionally limited to one project. Live sessions are read from OpenCode's
   * database in quarter-hour slots; deleted ones come from the ledger. Days without usage are left out.
   */
  async daily(input: { from: number; to: number; project?: string; timezone?: string }): Promise<DailyResult> {
    await this.fresh()
    const db = this.db
    if (!db) throw new Error("OpenCode database is not open")
    const dayOf = dayFormatter(input.timezone)
    const days = new Map<string, Map<string, RetainedModel>>()
    const add = (row: Row) => {
      const date = dayOf(row[0])
      let models = days.get(date)
      if (!models) {
        models = new Map()
        days.set(date, models)
      }
      addRow(modelBucket(models, row), row)
    }

    const rows = db.all(
      `SELECT ${USAGE_COLUMNS}
       FROM session_message m JOIN session_v2 s ON s.id = m.session_id
       WHERE m.type = 'assistant'
         AND json_extract(m.data, '$.tokens') IS NOT NULL
         AND m.time_created >= ? AND m.time_created < ?
         ${input.project ? "AND (s.project_id = ? OR s.id IN (SELECT value FROM json_each(?)))" : ""}
       GROUP BY slot, provider, model`,
      ...(input.project
        ? [input.from, input.to, input.project, JSON.stringify(this.adoptedIDs(input.project))]
        : [input.from, input.to]),
    )
    for (const r of rows) {
      const row = toRow(r)
      if (row) add(row)
    }
    for (const entry of this.deleted.values()) {
      if (!Ledger.inProject(entry, input.project)) continue
      for (const row of entry.rows) if (row[0] >= input.from && row[0] < input.to) add(row)
    }
    return {
      days: [...days]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, models]) => ({ date, models: [...models.values()] })),
    }
  }

  /** Syncs now, after each finished step or deletion, and every few minutes. Returns a cleanup. */
  start(subscribe: (signal: AbortSignal) => AsyncIterable<unknown>) {
    const controller = new AbortController()
    this.schedule()
    void (async () => {
      try {
        for await (const _ of subscribe(controller.signal)) this.schedule()
      } catch (error) {
        if (!controller.signal.aborted) this.log(`event stream ended: ${message(error)}`)
      }
    })()
    const backstop = setInterval(() => this.schedule(), BACKSTOP_MS)
    return () => {
      this.stopped = true
      this.pending = false
      controller.abort()
      clearInterval(backstop)
      if (this.timer) clearTimeout(this.timer)
      this.timer = undefined
      // A running sync still uses the database; close it once that sync is done.
      const close = () => {
        this.db?.close()
        this.db = undefined
      }
      if (this.running) void this.running.catch(() => {}).finally(close)
      else close()
    }
  }
}
