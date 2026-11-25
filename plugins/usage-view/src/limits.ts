import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { Database } from "./ledger"
import type { LimitProvider, LimitReset, LimitWindow, LimitsResult } from "./types"

const execFileAsync = promisify(execFile)

/**
 * Subscription limits come from the providers, not from local history:
 * - Claude Code: GET https://api.anthropic.com/api/oauth/usage with the OAuth
 *   access token from the Claude credentials. The token is Claude Code's own; it is never refreshed here, since
 *   that could rotate the refresh token and sign Claude Code out.
 * - Codex: GET https://chatgpt.com/backend-api/wham/usage with the access
 *   token from ~/.codex/auth.json plus the ChatGPT account id from the JWT.
 * - OpenCode Go: GET https://opencode.ai/inference/go/v1/usage with a Go API key
 *   or the Console login token from OpenCode's own database (`credential` table).
 *   The Console token is never refreshed here either.
 *
 * Results are cached briefly so opening the view never hammers the providers;
 * the OAuth usage endpoint is aggressively rate limited per access token.
 */

const MIN_INTERVAL_MS = 60_000
const CODEX_API = "https://chatgpt.com/backend-api/wham"
const MANAGE_URLS = {
  claude: "https://claude.ai/settings/usage",
  codex: "https://chatgpt.com/codex/settings/usage",
  opencode: "https://opencode.ai/console/go",
} as const
const CLAUDE_BETA = "oauth-2025-04-20"

interface ClaudeCredentials {
  accessToken: string
  subscriptionType?: string
}

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return undefined
  }
}

async function keychainCredentials(service: string): Promise<any> {
  if (process.platform !== "darwin") return undefined
  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-w"], { timeout: 5000 })
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

async function claudeCredentials(): Promise<ClaudeCredentials | undefined> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN }
  }
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
  // On macOS the live token is in the Keychain; the file copy can be stale.
  const service =
    process.env.CLAUDE_CONFIG_DIR !== undefined
      ? `Claude Code-credentials-${createHash("sha256").update(dir).digest("hex").slice(0, 8)}`
      : "Claude Code-credentials"
  const oauth = (await keychainCredentials(service))?.claudeAiOauth ?? (await readJson(join(dir, ".credentials.json")))?.claudeAiOauth
  if (!oauth?.accessToken) return undefined
  return {
    accessToken: oauth.accessToken,
    subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : undefined,
  }
}

/** Reset times to the minute, so one computed from a relative delay stays the same between checks. */
const toMinute = (time: number) => Math.round(time / 60_000) * 60_000

interface ClaudeWindow {
  utilization?: number
  resets_at?: string
}

const CLAUDE_WINDOWS: { key: string; id: string; label: string; kind: LimitWindow["kind"] }[] = [
  { key: "five_hour", id: "session", label: "Session (5 hours)", kind: "session" },
  { key: "seven_day", id: "weekly", label: "Weekly (all models)", kind: "weekly" },
  { key: "seven_day_opus", id: "weekly-opus", label: "Weekly Opus", kind: "weekly" },
  { key: "seven_day_sonnet", id: "weekly-sonnet", label: "Weekly Sonnet", kind: "weekly" },
  { key: "seven_day_omelette", id: "weekly-design", label: "Weekly Claude Design", kind: "weekly" },
]

async function fetchClaude(credentials: ClaudeCredentials, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<LimitProvider> {
  const response = await fetcher("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": CLAUDE_BETA,
      "User-Agent": "claude-code/2.1.0",
    },
    signal,
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error("Claude Code token expired; open Claude Code to refresh it")
  }
  if (response.status === 429) throw new Error("rate limited by Anthropic; try again in a few minutes")
  if (!response.ok) throw new Error(`Anthropic usage API returned ${response.status}`)
  const body = await response.json()

  const windows: LimitWindow[] = []
  for (const spec of CLAUDE_WINDOWS) {
    const raw = body?.[spec.key] as ClaudeWindow | null | undefined
    if (!raw || typeof raw.utilization !== "number") continue
    const resetsAt = toMinute(typeof raw.resets_at === "string" ? Date.parse(raw.resets_at) : NaN)
    windows.push({
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      usedPercent: Math.max(0, Math.min(100, raw.utilization)),
      ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
    })
  }
  return {
    id: "claude",
    label: "Claude Code",
    ...(credentials.subscriptionType ? { account: credentials.subscriptionType } : {}),
    manageUrl: MANAGE_URLS.claude,
    windows,
  }
}

interface CodexAuth {
  accessToken: string
  accountId?: string
}

function jwtPayload(token: string): any {
  const part = token.split(".")[1]
  if (!part) return undefined
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
  } catch {
    return undefined
  }
}

async function codexAuth(): Promise<CodexAuth | undefined> {
  const dir = process.env.CODEX_HOME ?? join(homedir(), ".codex")
  const file = await readJson(join(dir, "auth.json"))
  const tokens = file?.tokens
  if (!tokens?.access_token) return undefined
  const payload = jwtPayload(tokens.access_token) ?? jwtPayload(tokens.id_token ?? "")
  const auth = payload?.["https://api.openai.com/auth"]
  return {
    accessToken: tokens.access_token,
    accountId: typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined,
  }
}

interface CodexWindow {
  used_percent?: number
  window_duration_mins?: number
  limit_window_seconds?: number
  resets_at?: number
  reset_at?: number
  reset_after_seconds?: number
}

export async function fetchCodex(auth: CodexAuth, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<LimitProvider> {
  if (!auth.accountId) throw new Error("no ChatGPT account id in the Codex credentials")
  const authed = { ...auth, accountId: auth.accountId }
  const response = await fetcher(`${CODEX_API}/usage`, { headers: codexHeaders(authed), signal })
  if (!response.ok) throw new Error(`Codex usage API returned ${response.status}`)
  const body = await response.json()
  const limits = body?.rate_limit ?? body?.rateLimits ?? {}
  const windows: LimitWindow[] = []
  const push = (raw: CodexWindow | null | undefined, id: string, label: string, kind: LimitWindow["kind"]) => {
    if (!raw || typeof raw.used_percent !== "number") return
    const resetAtSec = raw.reset_at ?? raw.resets_at
    const resetsAt = toMinute(
      typeof resetAtSec === "number" ? resetAtSec * 1000 : typeof raw.reset_after_seconds === "number" ? Date.now() + raw.reset_after_seconds * 1000 : NaN,
    )
    const durationSec = raw.limit_window_seconds ?? (typeof raw.window_duration_mins === "number" ? raw.window_duration_mins * 60 : undefined)
    windows.push({
      id,
      label,
      kind,
      usedPercent: Math.max(0, Math.min(100, raw.used_percent)),
      ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
      ...(typeof durationSec === "number" ? { windowDurationMins: durationSec / 60 } : {}),
    })
  }
  // Current shape uses primary_window/secondary_window; older clients saw primary/secondary.
  push(limits.primary_window ?? limits.primary, "session", "Session window", "session")
  push(limits.secondary_window ?? limits.secondary, "weekly", "Weekly", "weekly")
  const credits = body?.rate_limit_reset_credits?.available_count
  let resets: LimitReset[] = []
  if (typeof credits === "number" && credits > 0) {
    // The detailed list is optional: without it the count still shows.
    try {
      resets = await fetchCodexResets(authed, signal, fetcher)
    } catch (error) {
      if (signal.aborted) throw error
    }
  }
  return {
    id: "codex",
    label: "Codex",
    ...(typeof body?.plan_type === "string" ? { account: body.plan_type } : {}),
    ...(typeof credits === "number" && credits > 0 ? { resetCredits: credits } : {}),
    ...(resets.length > 0 ? { resets } : {}),
    manageUrl: MANAGE_URLS.codex,
    windows,
  }
}

const failed = (id: LimitProvider["id"], label: string, error: string): LimitProvider => ({
  id,
  label,
  windows: [],
  error,
  manageUrl: MANAGE_URLS[id],
})

/** ISO string, epoch seconds or epoch ms to epoch ms. */
function parseTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value
  if (typeof value === "string" && value.trim()) {
    const time = /^\d+(\.\d+)?$/.test(value.trim()) ? parseTime(Number(value)) : Date.parse(value)
    return time !== undefined && Number.isFinite(time) ? time : undefined
  }
  return undefined
}

export function parseCodexResets(body: any): LimitReset[] {
  const credits = Array.isArray(body?.credits) ? body.credits : []
  const resets: LimitReset[] = []
  for (const raw of credits) {
    if (!raw || typeof raw.id !== "string" || !raw.id) continue
    const grantedAt = parseTime(raw.granted_at)
    const expiresAt = parseTime(raw.expires_at)
    resets.push({
      id: raw.id,
      ...(typeof raw.title === "string" && raw.title ? { title: raw.title } : {}),
      status: typeof raw.status === "string" ? raw.status : "unknown",
      ...(grantedAt !== undefined ? { grantedAt } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    })
  }
  return resets
}

function codexHeaders(auth: CodexAuth & { accountId: string }): Record<string, string> {
  return { Authorization: `Bearer ${auth.accessToken}`, "ChatGPT-Account-Id": auth.accountId, Accept: "application/json" }
}

async function fetchCodexResets(auth: CodexAuth & { accountId: string }, signal: AbortSignal, fetcher: typeof fetch): Promise<LimitReset[]> {
  const response = await fetcher(`${CODEX_API}/rate-limit-reset-credits`, { headers: codexHeaders(auth), signal })
  if (!response.ok) throw new Error(`Codex reset credits API returned ${response.status}`)
  return parseCodexResets(await response.json())
}

/** Spends one banked Codex reset. This refreshes the 5-hour and weekly windows and cannot be undone. */
export async function consumeCodexReset(auth: CodexAuth, creditId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  if (!auth.accountId) throw new Error("no ChatGPT account id in the Codex credentials")
  const response = await fetcher(`${CODEX_API}/rate-limit-reset-credits/consume`, {
    method: "POST",
    headers: { ...codexHeaders({ ...auth, accountId: auth.accountId }), "Content-Type": "application/json" },
    body: JSON.stringify({ credit_id: creditId, redeem_request_id: randomUUID() }),
    signal,
  })
  if (response.ok) return
  let detail = ""
  try {
    const body: any = await response.json()
    const message = body?.error?.message ?? body?.message ?? body?.detail ?? body?.error
    if (typeof message === "string" && message) detail = `: ${message}`
  } catch {}
  throw new Error(`Codex reset failed (${response.status})${detail}`)
}

export interface GoCredentials {
  token: string
  account?: string
  /** Epoch ms when the token expires (Console login only). */
  expires?: number
}

export type GoReader = <T>(fn: (db: Database) => T) => Promise<T>

function parseJson(value: unknown): any {
  if (typeof value !== "string") return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Picks the token from `credential` rows (newest first): a Go API key wins over the Console login. */
export function selectGoCredentials(rows: { integration_id: string; value: unknown; time_updated?: number; active?: number }[]): GoCredentials | undefined {
  const sorted = rows
    .filter((row) => row.active === undefined || row.active === 1)
    .sort((a, b) => Number(b.time_updated ?? 0) - Number(a.time_updated ?? 0))
  for (const row of sorted) {
    if (row.integration_id !== "opencode-go") continue
    const value = parseJson(row.value)
    if (value?.type === "key" && typeof value.key === "string" && value.key) return { token: value.key }
  }
  for (const row of sorted) {
    if (row.integration_id !== "opencode") continue
    const value = parseJson(row.value)
    if (value?.type === "oauth" && typeof value.access === "string" && value.access) {
      return {
        token: value.access,
        ...(typeof value.expires === "number" ? { expires: value.expires } : {}),
        ...(typeof value.metadata?.orgName === "string" && value.metadata.orgName ? { account: value.metadata.orgName } : {}),
      }
    }
  }
  return undefined
}

async function goCredentials(read: GoReader | undefined): Promise<GoCredentials | undefined> {
  if (!read) return undefined
  try {
    const rows = await read((db) =>
      db.all(
        "SELECT integration_id, value, time_updated, active FROM credential WHERE active = 1 AND integration_id IN ('opencode-go', 'opencode') ORDER BY time_updated DESC",
      ),
    )
    return selectGoCredentials(rows)
  } catch {
    return undefined
  }
}

const GO_WINDOWS: { key: string; id: string; label: string; kind: LimitWindow["kind"]; mins?: number }[] = [
  { key: "rolling", id: "session", label: "Session (5 hours)", kind: "session", mins: 300 },
  { key: "weekly", id: "weekly", label: "Weekly", kind: "weekly" },
  { key: "monthly", id: "monthly", label: "Monthly", kind: "monthly" },
]

export function parseGoUsage(body: any, account?: string): LimitProvider {
  const windows: LimitWindow[] = []
  for (const spec of GO_WINDOWS) {
    const raw = body?.usage?.[spec.key]
    if (!raw || typeof raw.percent !== "number") continue
    const resetsAt = toMinute(typeof raw.resetsAt === "string" ? Date.parse(raw.resetsAt) : NaN)
    windows.push({
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      usedPercent: Math.max(0, Math.min(100, raw.status === "rate-limited" ? Math.max(100, raw.percent) : raw.percent)),
      ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
      ...(spec.mins ? { windowDurationMins: spec.mins } : {}),
    })
  }
  return { id: "opencode", label: "OpenCode Go", ...(account ? { account } : {}), manageUrl: MANAGE_URLS.opencode, windows }
}

async function fetchGo(credentials: GoCredentials, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<LimitProvider> {
  if (credentials.expires !== undefined && credentials.expires <= Date.now()) {
    throw new Error("OpenCode Console token expired; sign in again with /connect")
  }
  const response = await fetcher("https://opencode.ai/inference/go/v1/usage", {
    headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json", "User-Agent": "usage-view/0.1" },
    signal,
  })
  if (response.status === 401) throw new Error("OpenCode credentials invalid; sign in again with /connect")
  if (response.status === 403) {
    let message = "OpenCode Go subscription required."
    try {
      const body: any = await response.json()
      if (typeof body?.error?.message === "string" && body.error.message) message = body.error.message
    } catch {}
    throw new Error(message)
  }
  if (!response.ok) throw new Error(`OpenCode Go usage API returned ${response.status}`)
  return parseGoUsage(await response.json(), credentials.account)
}

export { fetchGo }

export class Limits {
  constructor(
    private readonly read?: GoReader,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private cache: { at: number; result: LimitsResult } | undefined
  /** The check in flight, shared by concurrent callers, with the signal it runs under. */
  private inflight: { promise: Promise<LimitsResult>; signal: AbortSignal } | undefined

  async limits(refresh: boolean, signal: AbortSignal): Promise<LimitsResult> {
    if (!refresh && this.cache && Date.now() - this.cache.at < MIN_INTERVAL_MS) return this.cache.result
    // A check already in flight started after the cache went stale, so it serves a refresh too.
    let inflight = this.inflight
    if (!inflight) {
      const promise = this.check(signal).finally(() => {
        if (this.inflight?.promise === promise) this.inflight = undefined
      })
      inflight = this.inflight = { promise, signal }
    }
    try {
      return await inflight.promise
    } catch (error) {
      // The caller that started the shared check went away; check again for this one.
      if (inflight.signal !== signal && inflight.signal.aborted && !signal.aborted) return this.limits(refresh, signal)
      throw error
    }
  }

  /** Spends a banked Codex reset, then re-checks every provider. */
  async redeemReset(provider: string, creditId: string, signal: AbortSignal): Promise<LimitsResult> {
    if (provider !== "codex") throw new Error(`${provider} resets cannot be redeemed here`)
    if (typeof creditId !== "string" || !creditId) throw new Error("missing reset id")
    const auth = await codexAuth()
    if (!auth) throw new Error("not signed in (no Codex credentials found)")
    await consumeCodexReset(auth, creditId, signal, this.fetcher)
    this.cache = undefined
    this.inflight = undefined
    return this.limits(true, signal)
  }

  private async check(signal: AbortSignal): Promise<LimitsResult> {
    const run = async (id: LimitProvider["id"], label: string, fn: () => Promise<LimitProvider>): Promise<LimitProvider> => {
      try {
        return await fn()
      } catch (error) {
        if (signal.aborted) throw error
        return failed(id, label, error instanceof Error ? error.message : String(error))
      }
    }
    const [claudeCreds, codex, go] = await Promise.all([claudeCredentials(), codexAuth(), goCredentials(this.read)])
    const providers = await Promise.all([
      claudeCreds
        ? run("claude", "Claude Code", () => fetchClaude(claudeCreds, signal, this.fetcher))
        : failed("claude", "Claude Code", "not signed in (no Claude credentials found)"),
      codex
        ? run("codex", "Codex", () => fetchCodex(codex, signal, this.fetcher))
        : failed("codex", "Codex", "not signed in (no Codex credentials found)"),
      go
        ? run("opencode", "OpenCode Go", () => fetchGo(go, signal, this.fetcher))
        : failed("opencode", "OpenCode Go", "not signed in (no OpenCode credentials found)"),
    ])
    const result: LimitsResult = { checkedAt: Date.now(), providers }
    this.cache = { at: Date.now(), result }
    return result
  }
}
