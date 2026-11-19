// Pure presence state: session events in, Discord activity out. No IO, no timers.

export type ModelRef = { id: string; providerID?: string }

export type Activity = {
  details: string
  state: string
  timestamps: { start: number }
  assets: { large_image: string; large_text: string }
}

export type PresenceEvent =
  | { type: "started"; sessionID: string; at: number; directory?: string; model?: ModelRef }
  | { type: "ended"; sessionID: string; at: number }
  | { type: "deleted"; sessionID: string; at: number }
  | { type: "model"; sessionID: string; at: number; model: ModelRef; directory?: string }

export type PresenceOptions = {
  largeImage: string
  idleTimeoutMs: number
  /** Max length of the details line (default 32, never more than Discord's 128). */
  maxDetailsLength?: number
  /** Human name for a model, if known. */
  modelName?: (model: ModelRef) => string | undefined
}

type Session = { busy: boolean; directory?: string; model?: ModelRef }

export function projectName(directory: string | undefined) {
  if (!directory) return undefined
  const trimmed = directory.replace(/[\\/]+$/, "")
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || undefined
}

const DEFAULT_DETAILS_LENGTH = 32
const DISCORD_DETAILS_LIMIT = 128

/** Joins as many names as fit, collapsing the rest into " +N". The first name is always shown, truncated if needed. */
function formatProjects(names: string[], maxLength: number) {
  const limit = Math.min(maxLength, DISCORD_DETAILS_LIMIT)
  const suffix = (hidden: number) => (hidden > 0 ? ` +${hidden}` : "")
  for (let count = names.length; count >= 1; count--) {
    const text = names.slice(0, count).join(", ") + suffix(names.length - count)
    if (text.length <= limit) return text
  }
  const rest = suffix(names.length - 1)
  const room = Math.max(1, limit - rest.length)
  const first = names[0]!
  return (first.length <= room ? first : first.slice(0, Math.max(0, room - 1)) + "…") + rest
}

export class Presence {
  private sessions = new Map<string, Session>()
  private since = 0
  private working = false
  /** Whether the presence was visible just before the event being applied. */
  private shown = false
  private lastEventAt = 0
  private spend: string | undefined

  constructor(private options: PresenceOptions) {}

  /** Text for the large image tooltip, e.g. "Spent today: $4.20"; undefined shows "OpenCode". */
  setSpend(text: string | undefined) {
    this.spend = text
  }

  isWorking() {
    return this.working
  }

  /** True when the event changed anything that could be shown. */
  apply(event: PresenceEvent) {
    // Expiry is lazy, so check it against the previous event time before overwriting it.
    const expiresAt = this.expiresAt()
    this.shown = this.sessions.size > 0 && (expiresAt === undefined || event.at < expiresAt)
    this.lastEventAt = event.at
    if (event.type === "deleted") {
      this.sessions.delete(event.sessionID)
      return this.refresh(event.at)
    }
    const session = this.sessions.get(event.sessionID) ?? { busy: false }
    // Map order is recency order: the last entry is the most recently active session.
    this.sessions.delete(event.sessionID)
    this.sessions.set(event.sessionID, session)
    if (event.type !== "ended" && event.directory) session.directory = event.directory
    if ((event.type === "started" || event.type === "model") && event.model) session.model = event.model
    if (event.type === "started") session.busy = true
    if (event.type === "ended") session.busy = false
    return this.refresh(event.at)
  }

  private refresh(at: number) {
    const working = [...this.sessions.values()].some((s) => s.busy)
    // The timer starts when the presence appears and survives Working/Idle switches.
    if (!this.shown) this.since = at
    this.working = working
    return true
  }

  /** Time at which `activity` will turn into null, if nothing else happens. */
  expiresAt() {
    if (this.working || this.sessions.size === 0) return undefined
    return this.lastEventAt + this.options.idleTimeoutMs
  }

  activity(now: number): Activity | null {
    const session = [...this.sessions.values()].at(-1)
    if (!session) return null
    if (this.expiresAt() !== undefined && now >= this.expiresAt()!) return null
    const model = session.model
    const name = model ? (this.options.modelName?.(model) ?? model.id) : undefined
    const status = this.working ? "Working" : "Idle"
    // Busy projects, most recently active first; when nothing is busy, the most recent session's project.
    const busy = [...this.sessions.values()]
      .reverse()
      .filter((s) => s.busy)
      .map((s) => projectName(s.directory))
      .filter((n): n is string => !!n)
    const names = [...new Set(busy)]
    const details = names.length
      ? formatProjects(names, this.options.maxDetailsLength ?? DEFAULT_DETAILS_LENGTH)
      : (projectName(session.directory) ?? "OpenCode")
    return {
      details,
      state: name ? `${status} · ${name}` : status,
      timestamps: { start: this.since },
      assets: { large_image: this.options.largeImage, large_text: this.spend?.slice(0, DISCORD_DETAILS_LIMIT) || "OpenCode" },
    }
  }
}
