import type { Context } from "@opencode/plugin/gui"
import { Git } from "../rpc"
import type { BranchInfo, Graph, GraphScope, RepoStatus } from "../types"

/**
 * One RPC caller per plugin context; reads ctx.client on every call, as it changes after the server restarts.
 * Reads take createLatest's `signal`, so a superseded request is cancelled instead of left running.
 */
function makeCaller(ctx: Pick<Context, "client">) {
  return <T>(rpc: any, method: string, directory: string, input: object = {}, signal?: AbortSignal) => {
    const client = ctx.client.rpc(rpc) as unknown as Record<string, (input: object, options: object) => Promise<T>>
    return client[method]({ directory, ...input }, { location: { directory }, signal })
  }
}

export type GitApi = ReturnType<typeof makeGitApi>

export function makeGitApi(ctx: Pick<Context, "client">) {
  const call = makeCaller(ctx)

  return {
    repo: (dir: string, signal?: AbortSignal) => call<RepoStatus>(Git, "repo", dir, {}, signal),
    branches: (dir: string, signal?: AbortSignal) => call<BranchInfo[]>(Git, "branches", dir, {}, signal),
    graph: (dir: string, scope: GraphScope, limit: number, signal?: AbortSignal) =>
      call<Graph>(Git, "graph", dir, { scope, limit }, signal),
    show: (dir: string, hash: string) => call<string>(Git, "show", dir, { hash }),
    checkout: (dir: string, ref: string) => call<string>(Git, "checkout", dir, { ref }),
    create: (dir: string, name: string, start: string) => call<string>(Git, "create", dir, { name, start }),
    rename: (dir: string, name: string, from?: string) => call<string>(Git, "rename", dir, { name, from }),
    delete: (dir: string, name: string, force: boolean) => call<string>(Git, "delete", dir, { name, force }),
    merge: (dir: string, branch: string) => call<string>(Git, "merge", dir, { branch }),
    fetch: (dir: string) => call<string>(Git, "fetch", dir),
    pull: (dir: string) => call<string>(Git, "pull", dir),
    push: (dir: string) => call<string>(Git, "push", dir),
  }
}

export function errorMessage(error: unknown): string {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  const value = error as { message?: unknown; data?: { message?: unknown } }
  if (typeof value.data?.message === "string") return value.data.message
  if (typeof value.message === "string") return value.message
  return String(error)
}
