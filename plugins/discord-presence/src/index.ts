import { Plugin } from "@opencode/plugin"
import { DiscordIpc } from "./ipc"
import { createSpendRefresher } from "./refresher"
import { Presence, type ModelRef, type PresenceEvent } from "./presence"
import { createTrace, defaultTracePath, type TraceKind } from "./trace"

type Context = Parameters<typeof Plugin.define>[0] extends { setup: (ctx: infer C) => any } ? C : never

const TYPES = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.deleted",
  "session.model.selected",
] as const

const DEFAULT_IDLE_MINUTES = 15
const DEFAULT_MAX_DETAILS = 32

// The server loads the plugin once per location, all in one process, and the event stream is global (events from every
// location arrive on any subscription). They share one IPC connection, one presence state and one subscription.
const SHARED = Symbol.for("discord-presence.shared.v1")
type Shared = {
  key: string
  ipc: DiscordIpc
  presence: Presence
  contexts: Context[]
  names: Map<string, string>
  stop: () => void
  restart: () => void
  refs: number
}
const registry = globalThis as typeof globalThis & { [SHARED]?: Shared }

const log = (message: string) => console.warn(`discord-presence: ${message}`)

function create(
  clientId: string,
  largeImage: string,
  idleTimeoutMs: number,
  maxDetailsLength: number,
  showSpend: boolean,
  trace?: (kind: TraceKind, reason?: string) => void,
): Shared {
  const names = new Map<string, string>()
  const presence = new Presence({
    largeImage,
    idleTimeoutMs,
    maxDetailsLength,
    modelName: (model) => names.get(`${model.providerID}/${model.id}`) ?? names.get(`/${model.id}`),
  })
  const ipc = new DiscordIpc({ clientId, log, trace })
  const shared: Shared = { key: clientId, ipc, presence, contexts: [], names, refs: 0, stop() {}, restart() {} }
  let expiry: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  const publish = () => {
    clearTimeout(expiry)
    const activity = presence.activity(Date.now())
    // A null activity with an expiry still pending means the idle timeout passed; without one, no sessions are left.
    ipc.setActivity(activity, activity ? undefined : presence.expiresAt() === undefined ? "no-sessions" : "idle")
    const at = presence.expiresAt()
    if (at !== undefined) expiry = setTimeout(publish, Math.max(0, at - Date.now()) + 50)
  }

  const owner = () => shared.contexts[0]

  const spend = showSpend
    ? createSpendRefresher({
        rpc: () => {
          const ctx = owner()
          return ctx ? (definition) => ctx.rpc(definition as any) : undefined
        },
        onText: (text) => {
          presence.setSpend(text)
          publish()
        },
        log,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    : undefined

  const loadNames = async (ctx: Context) => {
    try {
      const list = await ctx.model.list()
      for (const model of list.data) {
        names.set(`${model.providerID}/${model.id}`, model.name)
        if (!names.has(`/${model.id}`)) names.set(`/${model.id}`, model.name)
      }
    } catch {}
  }

  const handle = async (ctx: Context, event: any) => {
    const sessionID: string | undefined = event.data?.sessionID
    if (!sessionID) return
    const at = Date.now()
    const directory: string | undefined = event.location?.directory
    let next: PresenceEvent
    switch (event.type) {
      case "session.execution.started": {
        // The event carries no model or directory; read them from the session when not already known.
        let model: ModelRef | undefined
        let dir = directory
        try {
          const session = await ctx.session.get({ sessionID })
          model = session.model ? { id: session.model.id, providerID: session.model.providerID } : undefined
          dir ??= session.location?.directory
        } catch {}
        next = { type: "started", sessionID, at, directory: dir, model }
        break
      }
      case "session.model.selected":
        next = {
          type: "model",
          sessionID,
          at,
          directory,
          model: { id: event.data.model.id, providerID: event.data.model.providerID },
        }
        break
      case "session.deleted":
        next = { type: "deleted", sessionID, at }
        break
      default:
        next = { type: "ended", sessionID, at }
    }
    presence.apply(next)
    publish()
    if (next.type === "ended") void spend?.refresh()
    spend?.setWorking(presence.isWorking())
  }

  shared.restart = () => {
    controller?.abort()
    const ctx = owner()
    if (!ctx) return
    const mine = (controller = new AbortController())
    void loadNames(ctx)
    void spend?.refresh()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ types: [...TYPES], signal: mine.signal })) {
          await handle(ctx, event)
        }
      } catch (error) {
        if (!mine.signal.aborted) log(`event stream stopped: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }
  shared.stop = () => {
    controller?.abort()
    spend?.stop()
    clearTimeout(expiry)
    void ipc.close()
  }
  ipc.start()
  return shared
}

export default Plugin.define({
  id: "discord-presence",
  setup(ctx) {
    const clientId = typeof ctx.options.clientId === "string" ? ctx.options.clientId.trim() : ""
    if (!clientId) {
      log("`clientId` option is not set; Discord presence is disabled")
      return
    }
    const largeImage = typeof ctx.options.largeImage === "string" && ctx.options.largeImage ? ctx.options.largeImage : "opencode"
    const minutes = Number(ctx.options.idleTimeout)
    const idleMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES) * 60_000
    const maxDetails = Number(ctx.options.maxDetailsLength)
    const maxDetailsLength = Number.isInteger(maxDetails) && maxDetails > 0 ? maxDetails : DEFAULT_MAX_DETAILS

    const showSpend = ctx.options.showSpend !== false

    let shared = registry[SHARED]
    // A shared entry from an older code load or another client id is replaced; its own instances stop it on cleanup.
    if (shared && shared.key !== clientId) {
      shared.stop()
      shared = undefined
    }
    const debugPath =
      typeof ctx.options.debugLogPath === "string" && ctx.options.debugLogPath ? ctx.options.debugLogPath : defaultTracePath()
    const trace = ctx.options.debugLog === false ? undefined : createTrace(debugPath)
    if (!shared) shared = registry[SHARED] = create(clientId, largeImage, idleMs, maxDetailsLength, showSpend, trace)
    const mine = shared
    mine.refs++
    mine.contexts.push(ctx)
    if (mine.contexts.length === 1) mine.restart()

    return () => {
      const index = mine.contexts.indexOf(ctx)
      if (index >= 0) mine.contexts.splice(index, 1)
      // Hand the subscription to a remaining instance when the owner unloads.
      if (index === 0) mine.restart()
      if (--mine.refs > 0) return
      mine.stop()
      if (registry[SHARED] === mine) delete registry[SHARED]
    }
  },
})
