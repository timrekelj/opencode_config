import { Plugin } from "@opencode/plugin"
import { GhError, GitHub } from "./gh"
import { PrReview } from "./rpc"
import type { ListState } from "./types"

interface Base {
  directory: string
}

export default Plugin.define({
  id: "pr-review",
  async setup(ctx) {
    const github = new GitHub(typeof ctx.options.gh === "string" ? ctx.options.gh : "gh")

    const handle =
      <I, O>(fn: (input: I & Base, signal: AbortSignal) => Promise<O>) =>
      async (input: unknown, context: { signal: AbortSignal; error: (...args: any[]) => any }) => {
        try {
          // RPC outputs must be plain JSON: drop `undefined` fields (e.g. optional check URLs).
          return JSON.parse(JSON.stringify((await fn(input as I & Base, context.signal)) ?? null))
        } catch (error) {
          const message = error instanceof GhError || error instanceof Error ? error.message : String(error)
          return context.error("gh_failed", message, { message })
        }
      }

    await ctx.rpc.register(PrReview, {
      repo: handle((i) => github.repo(i.directory)),
      list: handle<{ state?: ListState }, unknown>((i, signal) => github.list(i.directory, i.state ?? "open", signal)),
      detail: handle<{ number: number }, unknown>((i, signal) => github.detail(i.directory, i.number, signal)),
      files: handle<{ number: number }, unknown>((i, signal) => github.files(i.directory, i.number, signal)),
      current: handle((i, signal) => github.current(i.directory, signal)),
      setViewed: handle<{ number: number; path: string; viewed: boolean }, void>((i) =>
        github.setViewed(i.directory, i.number, i.path, i.viewed),
      ),
      comment: handle<{ number: number; body: string }, void>((i) => github.comment(i.directory, i.number, i.body)),
      reply: handle<{ number: number; commentID: number; body: string }, void>((i) =>
        github.reply(i.directory, i.number, i.commentID, i.body),
      ),
      submitReview: handle<Parameters<GitHub["submitReview"]>[1], void>((i) => github.submitReview(i.directory, i)),
      merge: handle<{ number: number; method: string }, void>((i) => github.merge(i.directory, i.number, i.method)),
      checkout: handle<{ number: number }, void>((i) => github.checkout(i.directory, i.number)),
      ready: handle<{ number: number }, void>((i) => github.ready(i.directory, i.number)),
    } as any)
  },
})
