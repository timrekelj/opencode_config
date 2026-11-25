import { Plugin } from "@opencode/plugin"
import { autoReview } from "./auto-review"
import * as git from "./git"
import { Git } from "./rpc"
import type { GraphScope } from "./types"

interface Base {
  directory: string
}

export default Plugin.define({
  id: "github",
  async setup(ctx) {
    const handle =
      <I, O>(fn: (input: I & Base, signal: AbortSignal) => Promise<O>) =>
      async (input: unknown, context: { signal: AbortSignal; error: (...args: any[]) => any }) => {
        try {
          // RPC outputs must be plain JSON: drop `undefined` fields (e.g. a missing remote URL).
          return JSON.parse(JSON.stringify((await fn(input as I & Base, context.signal)) ?? null))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return context.error("git_failed", message, { message })
        }
      }

    const optionLimit = Number(ctx.options.limit)
    const limit = Number.isFinite(optionLimit) && optionLimit > 0 ? optionLimit : 300

    await ctx.rpc.register(Git, {
      repo: handle((i, signal) => git.repo(i.directory, signal)),
      branches: handle((i, signal) => git.branches(i.directory, signal)),
      graph: handle<{ scope?: string; limit?: number }, unknown>((i, signal) =>
        git.graph(
          i.directory,
          i.scope === "local" || i.scope === "current" ? (i.scope as GraphScope) : "all",
          Number(i.limit) > 0 ? Number(i.limit) : limit,
          signal,
        ),
      ),
      show: handle<{ hash: string }, string>((i, signal) => git.show(i.directory, i.hash, signal)),
      checkout: handle<{ ref: string }, string>((i, signal) => git.checkout(i.directory, i.ref, signal)),
      create: handle<{ name: string; start?: string }, string>((i, signal) =>
        git.create(i.directory, i.name, i.start ?? "", signal),
      ),
      rename: handle<{ name: string; from?: string }, string>((i, signal) =>
        git.rename(i.directory, i.name, i.from, signal),
      ),
      delete: handle<{ name: string; force: boolean }, string>((i, signal) =>
        git.del(i.directory, i.name, i.force, signal),
      ),
      merge: handle<{ branch: string }, string>((i, signal) => git.merge(i.directory, i.branch, signal)),
      fetch: handle<Record<string, never>, string>((i, signal) => git.fetch(i.directory, signal)),
      pull: handle<Record<string, never>, string>((i, signal) => git.pull(i.directory, signal)),
      push: handle<Record<string, never>, string>((i, signal) => git.push(i.directory, signal)),
    } as any)

    if (ctx.options.autoReview !== false) await autoReview(ctx)
  },
})
