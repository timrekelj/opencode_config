import type { Context, Persisted, SessionRef } from "@opencode/plugin/gui"
import { Schema } from "effect"

export const Owned = Schema.Struct({
  forks: Schema.Array(
    Schema.Struct({
      server: Schema.String,
      id: Schema.String,
      /** The window that made the fork; missing for forks an older version made. */
      window: Schema.optional(Schema.String),
      /** When the fork was made, to forget one whose server never comes back. */
      created: Schema.optional(Schema.Number),
    }),
  ),
  /** Each window's last heartbeat, by window id. A window that stopped beating is gone. */
  windows: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
})
export type Owned = typeof Owned.Type

/** A side chat: the fork of a main session, by the main session's `SessionRef.key`. */
interface Fork {
  server: string
  /** The fork's session id; undefined while the server forks. */
  id?: string
  /** When the fork was made, set once it is read-only and ready. Messages before it are the main session's history. */
  created?: number
  error?: string
  /** Tells a fork in flight whether its side chat is still the one that asked for it. */
  token: number
}

// Appended to the fork's rules; the last matching rule wins, so the side chat can read and run things but not edit.
const READ_ONLY = { action: "edit", resource: "*", effect: "deny" } as const

const HEARTBEAT_MS = 30_000
// Hidden windows' timers run about once a minute, so a window is only taken for gone well after that.
const GONE_MS = 5 * 60_000
// A longer gap between this window's own ticks means it was asleep, and so were the others: let them beat first.
const AWAKE_MS = 2 * 60_000
// Forks of a server that never reconnects are forgotten after this.
const MAX_AGE_MS = 7 * 24 * 60 * 60_000

export function errorMessage(error: unknown): string {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  const value = error as { message?: unknown; data?: { message?: unknown } }
  if (typeof value.data?.message === "string") return value.data.message
  if (typeof value.message === "string") return value.message
  return String(error)
}

const notFound = (error: unknown) =>
  typeof error === "object" && !!error && (error as { _tag?: unknown })._tag === "SessionNotFoundError"

export type Forks = ReturnType<typeof makeForks>

export function makeForks(ctx: Context, owned: Persisted<Owned, Owned>) {
  // Window-local and kept across plugin reloads, so a reload does not lose track of the open side chats. The window id
  // is too: a window reload gets a new one, so the forks the old page left behind are swept like a closed window's.
  const [state, setState] = ctx.storage.memory("forks", { initial: { bySession: {} as Record<string, Fork> } })
  const windowId = ctx.storage.memory("window", { initial: { id: crypto.randomUUID() } })[0].id

  const own = (server: string, id: string) =>
    owned.update((draft) => void draft.forks.push({ server, id, window: windowId, created: Date.now() }))
  const disown = (server: string, id: string) =>
    owned.update((draft) => {
      draft.forks = draft.forks.filter((fork) => fork.server !== server || fork.id !== id)
    })

  // Deletes a fork, and disowns it once the server confirms it is gone. A fork that could not be deleted stays owned,
  // so a later sweep tries again.
  const removing = new Set<string>()
  const remove = async (server: string, id: string) => {
    const client = ctx.servers.get(server)?.client
    if (!client || removing.has(id)) return
    removing.add(id)
    try {
      await client.session.remove({ sessionID: id })
      disown(server, id)
    } catch (error) {
      if (notFound(error)) disown(server, id)
    } finally {
      removing.delete(id)
    }
  }

  const get = (key: string): Fork | undefined => state.bySession[key]

  // Window-local promises of forks in flight, so a caller can wait for the side chat it asked for.
  const inflight = new Map<number, Promise<void>>()

  /** Forks the main session for its side chat, unless it has one. Resolves once the fork is ready or failed. */
  const start = (session: SessionRef): Promise<void> => {
    const existing = get(session.key)
    if (existing && !existing.error) return inflight.get(existing.token) ?? Promise.resolve()
    const token = Math.random()
    const run = fork(session, token).finally(() => inflight.delete(token))
    inflight.set(token, run)
    return run
  }

  const fork = async (session: SessionRef, token: number) => {
    const server = session.server.id
    const current = () => get(session.key)?.token === token
    const set = (patch: Partial<Fork>) =>
      setState((draft) => void (draft.bySession[session.key] = { server, token, ...patch }))
    set({})
    const client = session.server.client
    let id: string | undefined
    try {
      const info = await client.session.fork({ sessionID: session.id })
      id = info.id
      // Owned at once, so a fork whose removal fails is retried by the sweep.
      own(server, id)
      if (!current()) return void remove(server, id)
      set({ id })
      const title = session.server.data.session.get(session.id)?.title
      await client.session.update({
        sessionID: id,
        title: title ? `Side chat · ${title}` : "Side chat",
        metadata: { ...info.metadata, sideChat: { parent: session.id } },
        permissions: [...(info.permissions ?? []), READ_ONLY],
      })
      // Closed or restarted while forking: nothing shows this fork.
      if (!current()) return void remove(server, id)
      set({ id, created: info.time.created })
    } catch (error) {
      // Never leave a fork without the read-only rule behind.
      if (id) void remove(server, id)
      if (current()) set({ error: errorMessage(error) })
    }
  }

  const discard = (key: string) => {
    const fork = get(key)
    if (!fork) return
    setState((draft) => void delete draft.bySession[key])
    if (fork.id) void remove(fork.server, fork.id)
  }

  /** Throws the side chat away and forks the main session again, with what it has done since. */
  const restart = (session: SessionRef) => {
    discard(session.key)
    return start(session)
  }

  // Side chats do not outlive their window. Each window beats into the shared store; forks of a window that stopped
  // beating (closed, crashed or reloaded) are deleted once their server is connected, and so are this window's own
  // forks that it no longer shows (a removal that failed). Forks older than MAX_AGE_MS are forgotten either way.
  const beat = (now: number) => owned.update((draft) => void ((draft.windows ??= {})[windowId] = now))

  const sweep = (now: number) => {
    const windows = owned.value.windows ?? {}
    const live = new Set(Object.values(state.bySession).flatMap((fork) => (fork.id ? [fork.id] : [])))
    const expired = (fork: Owned["forks"][number]) => fork.created !== undefined && now - fork.created > MAX_AGE_MS
    const gone = (id: string | undefined) => now - (id ? (windows[id] ?? 0) : 0) > GONE_MS
    for (const fork of owned.value.forks) {
      if (expired(fork) || (fork.window === windowId ? live.has(fork.id) : !gone(fork.window))) continue
      if (ctx.servers.get(fork.server)?.connected) void remove(fork.server, fork.id)
    }
    owned.update((draft) => {
      draft.forks = draft.forks.filter((fork) => !expired(fork))
      // Forget the beats of gone windows that no fork names anymore.
      const named = new Set(draft.forks.map((fork) => fork.window))
      const beats = (draft.windows ??= {})
      for (const id of Object.keys(beats)) if (id !== windowId && gone(id) && !named.has(id)) delete beats[id]
      beats[windowId] = now
    })
  }

  let last = Date.now()
  beat(last)
  const timer = setInterval(() => {
    const now = Date.now()
    const awake = now - last < AWAKE_MS
    last = now
    if (awake) sweep(now)
    else beat(now)
  }, HEARTBEAT_MS)
  ctx.signal.addEventListener("abort", () => clearInterval(timer), { once: true })

  return { get, start, discard, restart }
}
