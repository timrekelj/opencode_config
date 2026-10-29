import { Plugin } from "@opencode/plugin"
import { GhError, GitHub } from "./gh"
import * as git from "./git"
import { GitError } from "./git"
import { Git, PrReview } from "./rpc"
import type { GraphScope, ListState } from "./types"

interface Base {
  directory: string
}

export default Plugin.define({
  id: "github",
  async setup(ctx) {
    const github = new GitHub(typeof ctx.options.gh === "string" ? ctx.options.gh : "gh")

    const handle =
      <I, O>(fn: (input: I & Base, signal: AbortSignal) => Promise<O>) =>
      async (input: unknown, context: { signal: AbortSignal; error: (...args: any[]) => any }) => {
        try {
          // RPC outputs must be plain JSON: drop `undefined` fields (e.g. optional check URLs).
          return JSON.parse(JSON.stringify((await fn(input as I & Base, context.signal)) ?? null))
        } catch (error) {
          const message = error instanceof GhError || error instanceof GitError || error instanceof Error ? error.message : String(error)
          return context.error(error instanceof GitError ? "git_failed" : "gh_failed", message, { message })
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
  },
})
