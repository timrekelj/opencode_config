import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { LimitProvider, LimitWindow, LimitsResult } from "./types"

const execFileAsync = promisify(execFile)

/**
 * Subscription limits come from the providers, not from local history:
 * - Claude Code: GET https://api.anthropic.com/api/oauth/usage with the OAuth
 *   access token from the Claude credentials. The token is Claude Code's own; it is never refreshed here, since
 *   that could rotate the refresh token and sign Claude Code out.
 * - Codex: GET https://chatgpt.com/backend-api/wham/usage with the access
 *   token from ~/.codex/auth.json plus the ChatGPT account id from the JWT.
 *
 * Results are cached briefly so opening the view never hammers the providers;
 * the OAuth usage endpoint is aggressively rate limited per access token.
 */

const MIN_INTERVAL_MS = 60_000
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

async function fetchClaude(credentials: ClaudeCredentials, signal: AbortSignal): Promise<LimitProvider> {
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
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

async function fetchCodex(auth: CodexAuth, signal: AbortSignal): Promise<LimitProvider> {
  if (!auth.accountId) throw new Error("no ChatGPT account id in the Codex credentials")
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "ChatGPT-Account-Id": auth.accountId,
      Accept: "application/json",
    },
    signal,
  })
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
  return {
    id: "codex",
    label: "Codex",
    ...(typeof body?.plan_type === "string" ? { account: body.plan_type } : {}),
    ...(typeof credits === "number" && credits > 0 ? { resetCredits: credits } : {}),
    windows,
  }
}

const failed = (id: LimitProvider["id"], label: string, error: string): LimitProvider => ({ id, label, windows: [], error })

export class Limits {
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

  private async check(signal: AbortSignal): Promise<LimitsResult> {
    const run = async (id: LimitProvider["id"], label: string, fn: () => Promise<LimitProvider>): Promise<LimitProvider> => {
      try {
        return await fn()
      } catch (error) {
        if (signal.aborted) throw error
        return failed(id, label, error instanceof Error ? error.message : String(error))
      }
    }
    const [claudeCreds, codex] = await Promise.all([claudeCredentials(), codexAuth()])
    const providers = await Promise.all([
      claudeCreds
        ? run("claude", "Claude Code", () => fetchClaude(claudeCreds, signal))
        : failed("claude", "Claude Code", "not signed in (no Claude credentials found)"),
      codex
        ? run("codex", "Codex", () => fetchCodex(codex, signal))
        : failed("codex", "Codex", "not signed in (no Codex credentials found)"),
    ])
    const result: LimitsResult = { checkedAt: Date.now(), providers }
    this.cache = { at: Date.now(), result }
    return result
  }
}
