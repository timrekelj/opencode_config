import type { Context, Persisted, SessionRef } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { createEffect } from "solid-js"

export const Owned = Schema.Struct({
  forks: Schema.Array(Schema.Struct({ server: Schema.String, id: Schema.String })),
})
export type Owned = typeof Owned.Type

/** A side chat: the fork of a main session, by the main session's `SessionRef.key`. */
export interface Fork {
  server: string
  parent: string
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

export function errorMessage(error: unknown): string {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  const value = error as { message?: unknown; data?: { message?: unknown } }
  if (typeof value.data?.message === "string") return value.data.message
  if (typeof value.message === "string") return value.message
  return String(error)
}

export type Forks = ReturnType<typeof makeForks>

export function makeForks(ctx: Context, owned: Persisted<Owned, Owned>) {
  // Window-local and kept across plugin reloads, so a reload does not lose track of the open side chats.
  const [state, setState] = ctx.storage.memory("forks", { initial: { bySession: {} as Record<string, Fork> } })

  const own = (server: string, id: string) => owned.update((draft) => void draft.forks.push({ server, id }))
  const disown = (server: string, id: string) =>
    owned.update((draft) => {
      draft.forks = draft.forks.filter((fork) => fork.server !== server || fork.id !== id)
    })

  const remove = (server: string, id: string) => {
    disown(server, id)
    const client = ctx.servers.get(server)?.client
    if (client) void client.session.remove({ sessionID: id }).catch(() => {})
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
      setState((draft) => void (draft.bySession[session.key] = { server, parent: session.id, token, ...patch }))
    set({})
    const client = session.server.client
    let id: string | undefined
    try {
      const info = await client.session.fork({ sessionID: session.id })
      id = info.id
      if (!current()) return remove(server, id)
      // Tracked before owned, or the sweep below takes the new fork for a leftover and deletes it.
      set({ id })
      own(server, id)
      const title = session.server.data.session.get(session.id)?.title
      await client.session.update({
        sessionID: id,
        title: title ? `Side chat · ${title}` : "Side chat",
        metadata: { ...info.metadata, sideChat: { parent: session.id } },
        permissions: [...(info.permissions ?? []), READ_ONLY],
      })
      // Closed or restarted while forking: nothing shows this fork.
      if (!current()) return remove(server, id)
      set({ id, created: info.time.created })
    } catch (error) {
      // Never leave a fork without the read-only rule behind.
      if (id) remove(server, id)
      if (current()) set({ error: errorMessage(error) })
    }
  }

  const discard = (key: string) => {
    const fork = get(key)
    if (!fork) return
    setState((draft) => void delete draft.bySession[key])
    if (fork.id) remove(fork.server, fork.id)
  }

  /** Throws the side chat away and forks the main session again, with what it has done since. */
  const restart = (session: SessionRef) => {
    discard(session.key)
    return start(session)
  }

  // Side chats do not outlive the window: forks this window no longer tracks (after a crash or a window reload) are
  // deleted once their server is connected.
  const swept = new Set<string>()
  createEffect(() => {
    const live = new Set(Object.values(state.bySession).flatMap((fork) => (fork.id ? [fork.id] : [])))
    for (const fork of owned.value.forks) {
      if (live.has(fork.id) || swept.has(fork.id)) continue
      if (!ctx.servers.get(fork.server)?.connected) continue
      swept.add(fork.id)
      remove(fork.server, fork.id)
    }
  })

  return { get, start, discard, restart }
}
