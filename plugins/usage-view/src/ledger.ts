import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import type { RetainedModel, RetainedRange, RetainedResult, TokenTotals } from "./types"

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
  deletedAt: number | null
  rows: Row[]
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

const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Entry).rows) &&
  typeof (value as Entry).projectID === "string"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Keeps a copy of every session's usage in plugin storage, so usage of deleted sessions still counts.
 * Live sessions are read from OpenCode's own stats; only deleted ones are answered from here.
 */
export class Ledger {
  private db: Database | undefined
  private syncedAt = 0
  /** Sessions in the ledger that still exist. */
  private live = new Set<string>()
  /** Sessions in the ledger that were deleted, with their usage. */
  private deleted = new Map<string, Entry>()
  private loaded: Promise<void> | undefined
  private running: Promise<void> | undefined
  private pending = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastRun = 0

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

  private async run() {
    await this.load()
    if (!this.db) {
      if (!existsSync(this.path)) throw new Error(`OpenCode database not found at ${this.path}`)
      this.db = await openDatabase(this.path)
      this.db.all("PRAGMA busy_timeout = 1000")
    }
    const db = this.db
    const startedAt = Date.now()
    const since = this.syncedAt > 0 ? this.syncedAt - SLACK_MS : 0

    // Re-aggregate every session with a message written since the last sync.
    const rows = db.all(
      `SELECT m.session_id AS session, s.project_id AS project, s.parent_id AS parent,
         (m.time_created / ${SLOT_MS}) * ${SLOT_MS} AS slot,
         json_extract(m.data, '$.model.providerID') AS provider,
         json_extract(m.data, '$.model.id') AS model,
         count(*) AS steps,
         sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) AS input,
         sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) AS output,
         sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) AS reasoning,
         sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) AS cache_read,
         sum(coalesce(json_extract(m.data, '$.tokens.cache.write'), 0)) AS cache_write,
         sum(coalesce(json_extract(m.data, '$.cost'), 0)) AS cost
       FROM session_message m JOIN session_v2 s ON s.id = m.session_id
       WHERE m.type = 'assistant'
         AND json_extract(m.data, '$.tokens') IS NOT NULL
         AND m.session_id IN (SELECT DISTINCT session_id FROM session_message WHERE time_updated >= ?)
       GROUP BY m.session_id, slot, provider, model`,
      since,
    )

    const changed = new Map<string, Entry>()
    for (const r of rows) {
      if (typeof r.provider !== "string" || typeof r.model !== "string") continue
      let entry = changed.get(r.session)
      if (!entry) {
        entry = { projectID: String(r.project), parentID: r.parent ?? null, deletedAt: null, rows: [] }
        changed.set(r.session, entry)
      }
      entry.rows.push([
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
      ])
    }
    for (const [id, entry] of changed) {
      await this.storage.set(PREFIX + id, entry)
      this.live.add(id)
      this.deleted.delete(id)
    }

    const existing = new Set<string>(db.all("SELECT id FROM session_v2").map((r) => r.id))
    for (const id of [...this.live]) {
      if (existing.has(id)) continue
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

  /** Usage of deleted sessions in each range, optionally limited to one project. */
  async retained(input: { ranges: { from?: number; to: number }[]; project?: string }): Promise<RetainedResult> {
    await this.sync()
    const ranges = input.ranges.map(() => ({
      sessions: 0,
      subagents: 0,
      steps: 0,
      cost: 0,
      tokens: emptyTokens(),
      byModel: new Map<string, RetainedModel>(),
      ids: new Set<string>(),
    }))
    let earliest: number | undefined
    for (const [id, entry] of this.deleted) {
      if (input.project && entry.projectID !== input.project) continue
      for (const row of entry.rows) {
        earliest = earliest === undefined ? row[0] : Math.min(earliest, row[0])
        input.ranges.forEach((range, index) => {
          if ((range.from !== undefined && row[0] < range.from) || row[0] >= range.to) return
          const target = ranges[index]!
          addRow(target, row)
          const key = `${row[1]}/${row[2]}`
          let model = target.byModel.get(key)
          if (!model) {
            model = { model: { providerID: row[1], id: row[2] }, steps: 0, cost: 0, tokens: emptyTokens() }
            target.byModel.set(key, model)
          }
          addRow(model, row)
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
      controller.abort()
      clearInterval(backstop)
      if (this.timer) clearTimeout(this.timer)
      this.db?.close()
      this.db = undefined
    }
  }
}
