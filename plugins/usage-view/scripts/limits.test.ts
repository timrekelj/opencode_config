import { expect, test } from "bun:test"
import { fetchGo, Limits, parseGoUsage, selectGoCredentials } from "../src/limits"

const body = {
  usage: {
    rolling: { status: "ok", percent: 12, resetsAt: "2026-11-24T12:10:23.000Z" },
    weekly: { status: "ok", percent: 40, resetsAt: "2026-11-30T00:00:00.000Z" },
    monthly: { status: "rate-limited", percent: 97, resetsAt: "2026-12-23T19:12:32.000Z" },
  },
}

test("parses the three Go windows", () => {
  const provider = parseGoUsage(body, "Acme")
  expect(provider.id).toBe("opencode")
  expect(provider.account).toBe("Acme")
  expect(provider.windows.map((w) => [w.id, w.kind, w.usedPercent])).toEqual([
    ["session", "session", 12],
    ["weekly", "weekly", 40],
    ["monthly", "monthly", 100],
  ])
  expect(provider.windows[0].windowDurationMins).toBe(300)
  expect(provider.windows[1].resetsAt).toBe(Date.parse("2026-11-30T00:00:00.000Z"))
})

test("skips missing windows", () => {
  expect(parseGoUsage({ usage: { weekly: { status: "ok", percent: 1 } } }).windows.map((w) => w.id)).toEqual(["weekly"])
  expect(parseGoUsage({}).windows).toEqual([])
})

const key = (k: string) => JSON.stringify({ type: "key", key: k })
const oauth = (access: string, expires: number, orgName?: string) =>
  JSON.stringify({ type: "oauth", access, expires, ...(orgName ? { metadata: { orgName } } : {}) })

test("prefers an opencode-go key over the Console login", () => {
  const picked = selectGoCredentials([
    { integration_id: "opencode", value: oauth("tok", 5, "Org"), time_updated: 9, active: 1 },
    { integration_id: "opencode-go", value: key("gk"), time_updated: 1, active: 1 },
  ])
  expect(picked).toEqual({ token: "gk" })
})

test("uses the newest active Console login with org name and expiry", () => {
  const picked = selectGoCredentials([
    { integration_id: "opencode", value: oauth("old", 1), time_updated: 1, active: 1 },
    { integration_id: "opencode", value: oauth("new", 7, "Org"), time_updated: 5, active: 1 },
    { integration_id: "opencode", value: oauth("inactive", 7), time_updated: 9, active: 0 },
  ])
  expect(picked).toEqual({ token: "new", expires: 7, account: "Org" })
})

test("no usable credential", () => {
  expect(selectGoCredentials([])).toBeUndefined()
  expect(selectGoCredentials([{ integration_id: "opencode", value: "not json", active: 1 }])).toBeUndefined()
})

const signal = new AbortController().signal
const reply = (status: number, data: unknown) =>
  (async () => new Response(JSON.stringify(data), { status })) as unknown as typeof fetch

test("fetchGo calls the endpoint with the bearer token", async () => {
  let seen: { url: string; init: any } | undefined
  const fetcher = (async (url: any, init: any) => {
    seen = { url: String(url), init }
    return new Response(JSON.stringify(body))
  }) as unknown as typeof fetch
  const provider = await fetchGo({ token: "t", expires: Date.now() + 60_000 }, signal, fetcher)
  expect(provider.windows).toHaveLength(3)
  expect(seen?.url).toBe("https://opencode.ai/inference/go/v1/usage")
  expect(seen?.init.headers.Authorization).toBe("Bearer t")
  expect(seen?.init.headers["User-Agent"]).toBe("usage-view/0.1")
})

test("fetchGo rejects an expired token without a request", async () => {
  const fetcher = (async () => {
    throw new Error("should not fetch")
  }) as unknown as typeof fetch
  await expect(fetchGo({ token: "t", expires: 1 }, signal, fetcher)).rejects.toThrow("sign in again with /connect")
})

test("fetchGo surfaces the entitlement message and 401", async () => {
  const message = "OpenCode Go subscription required."
  await expect(
    fetchGo({ token: "t" }, signal, reply(403, { type: "error", error: { type: "EntitlementError", message } })),
  ).rejects.toThrow(message)
  await expect(fetchGo({ token: "t" }, signal, reply(401, {}))).rejects.toThrow("invalid")
})

test("Limits reports a failed opencode provider without credentials", async () => {
  const limits = new Limits(async (fn) => fn({ all: () => [], close() {} }))
  const result = await limits.limits(true, signal)
  const go = result.providers.find((p) => p.id === "opencode")
  expect(go?.error).toBe("not signed in (no OpenCode credentials found)")
})

// --- Codex resets -----------------------------------------------------------------------------------------------------

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { consumeCodexReset, fetchCodex, parseCodexResets } from "../src/limits"

const auth = { accessToken: "tok", accountId: "acct" }
const usage = (count: number) => ({
  plan_type: "plus",
  rate_limit: { primary_window: { used_percent: 10, reset_after_seconds: 60 } },
  rate_limit_reset_credits: { available_count: count },
})

test("parses reset credits with ISO strings and epoch seconds or ms", () => {
  const resets = parseCodexResets({
    available_count: 3,
    credits: [
      { id: "RateLimitResetCredit_a", status: "available", granted_at: "2026-11-01T00:00:00.000Z", expires_at: "2026-12-01T00:00:00.000Z", title: "One free rate limit reset", extra: 1 },
      { id: "RateLimitResetCredit_b", status: "available", granted_at: 1_793_000_000, expires_at: 1_795_000_000_000 },
      { id: "RateLimitResetCredit_c", status: "used" },
      { status: "available" },
    ],
  })
  expect(resets).toEqual([
    { id: "RateLimitResetCredit_a", title: "One free rate limit reset", status: "available", grantedAt: Date.parse("2026-11-01T00:00:00.000Z"), expiresAt: Date.parse("2026-12-01T00:00:00.000Z") },
    { id: "RateLimitResetCredit_b", status: "available", grantedAt: 1_793_000_000_000, expiresAt: 1_795_000_000_000 },
    { id: "RateLimitResetCredit_c", status: "used" },
  ])
  expect(parseCodexResets({})).toEqual([])
})

test("fetchCodex lists credits only when some are available", async () => {
  const urls: string[] = []
  const fetcher = (async (url: any) => {
    urls.push(String(url))
    return new Response(JSON.stringify(String(url).endsWith("/usage") ? usage(1) : { credits: [{ id: "c1", status: "available" }] }))
  }) as unknown as typeof fetch
  const provider = await fetchCodex(auth, signal, fetcher)
  expect(urls).toEqual(["https://chatgpt.com/backend-api/wham/usage", "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"])
  expect(provider.resets).toEqual([{ id: "c1", status: "available" }])
  expect(provider.manageUrl).toBe("https://chatgpt.com/codex/settings/usage")

  urls.length = 0
  const none = (async (url: any) => {
    urls.push(String(url))
    return new Response(JSON.stringify(usage(0)))
  }) as unknown as typeof fetch
  expect((await fetchCodex(auth, signal, none)).resets).toBeUndefined()
  expect(urls).toHaveLength(1)
})

test("a failing credits list keeps the Codex provider and its count", async () => {
  const fetcher = (async (url: any) =>
    String(url).endsWith("/usage") ? new Response(JSON.stringify(usage(2))) : new Response("nope", { status: 500 })) as unknown as typeof fetch
  const provider = await fetchCodex(auth, signal, fetcher)
  expect(provider.error).toBeUndefined()
  expect(provider.resetCredits).toBe(2)
  expect(provider.resets).toBeUndefined()
  expect(provider.windows).toHaveLength(1)
})

test("consume posts the credit id with a UUID request id and auth headers", async () => {
  let seen: { url: string; init: any } | undefined
  const fetcher = (async (url: any, init: any) => {
    seen = { url: String(url), init }
    return new Response("{}")
  }) as unknown as typeof fetch
  await consumeCodexReset(auth, "RateLimitResetCredit_a", signal, fetcher)
  expect(seen?.url).toBe("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume")
  expect(seen?.init.method).toBe("POST")
  expect(seen?.init.headers.Authorization).toBe("Bearer tok")
  expect(seen?.init.headers["ChatGPT-Account-Id"]).toBe("acct")
  const sent = JSON.parse(seen?.init.body)
  expect(sent.credit_id).toBe("RateLimitResetCredit_a")
  expect(sent.redeem_request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
})

test("consume failure carries the status and the error message", async () => {
  await expect(consumeCodexReset(auth, "c", signal, reply(409, { error: { message: "already used" } }))).rejects.toThrow("409")
  await expect(consumeCodexReset(auth, "c", signal, reply(409, { error: { message: "already used" } }))).rejects.toThrow("already used")
})

test("redeemReset consumes, drops the cache and returns fresh limits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uv-codex-"))
  const jwt = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url")}.y`
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ tokens: { access_token: jwt } }))
  const saved = { home: process.env.CODEX_HOME, claude: process.env.CLAUDE_CODE_OAUTH_TOKEN }
  process.env.CODEX_HOME = dir
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "fake"
  try {
    let usages = 0
    const calls: string[] = []
    const fetcher = (async (url: any, init: any) => {
      const u = String(url)
      calls.push(`${init?.method ?? "GET"} ${u}`)
      if (u.endsWith("/consume")) return new Response("{}")
      if (u.endsWith("/wham/usage")) return new Response(JSON.stringify(usage(usages++ === 0 ? 1 : 0)))
      if (u.endsWith("/rate-limit-reset-credits")) return new Response(JSON.stringify({ credits: [{ id: "c1", status: "available" }] }))
      return new Response("{}", { status: 500 })
    }) as unknown as typeof fetch
    const limits = new Limits(undefined, fetcher)
    const first = await limits.limits(false, signal)
    expect(first.providers.find((p) => p.id === "codex")?.resets).toHaveLength(1)
    // A second non-refreshing call is served from the cache.
    await limits.limits(false, signal)
    expect(usages).toBe(1)

    const after = await limits.redeemReset("codex", "c1", signal)
    expect(usages).toBe(2)
    expect(calls).toContain("POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume")
    expect(after.providers.find((p) => p.id === "codex")?.resetCredits).toBeUndefined()
    // The new result is what the cache serves now.
    expect((await limits.limits(false, signal)).checkedAt).toBe(after.checkedAt)
    await expect(limits.redeemReset("claude", "x", signal)).rejects.toThrow("cannot be redeemed")
  } finally {
    if (saved.home === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = saved.home
    if (saved.claude === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.claude
  }
})
