import type { Plugin } from "@opencode/plugin"

const PULL_URL = /https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g

export function createdPr(command: string, output: string): { url: string; number: number } | undefined {
  if (!/\bgh\s+pr\s+create\b/.test(command)) return
  // gh prints the existing PR's URL when one already exists.
  if (/already exists/i.test(output)) return
  const matches = [...output.matchAll(PULL_URL)]
  const last = matches[matches.length - 1]
  if (!last) return
  return { url: last[0], number: Number(last[1]) }
}

const text = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
    .join("\n")
}

export async function autoReview(ctx: Plugin.Context) {
  const review = async (url: string, number: number, sessionID: string) => {
    const key = "auto-review/" + url
    if (await ctx.storage.get(key)) return
    await ctx.storage.set(key, true)
    // A PR created by a subagent is reviewed in the top-level session.
    let root = sessionID
    for (let depth = 0; depth < 10; depth++) {
      const parent = (await ctx.session.get({ sessionID: root })).parentID
      if (!parent) break
      root = parent
    }
    await ctx.session.command({ sessionID: root, name: "review", text: String(number), delivery: "queue" })
  }

  await ctx.tool.hook("execute.after", (event) => {
    try {
      if (event.tool !== "shell" || event.status !== "completed") return
      const result = event.result as { content?: unknown; metadata?: { exit?: unknown } }
      const exit = result.metadata?.exit
      if (typeof exit === "number" && exit !== 0) return
      const command = (event.input as { command?: unknown } | null | undefined)?.command
      if (typeof command !== "string") return
      const pr = createdPr(command, text(result.content))
      if (!pr) return
      review(pr.url, pr.number, event.sessionID).catch((error) => console.error("[github] auto-review", error))
    } catch (error) {
      console.error("[github] auto-review", error)
    }
  })
}
