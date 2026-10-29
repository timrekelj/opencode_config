import type { Context } from "@opencode/plugin/gui"
import { Git, PrReview } from "../rpc"
import type {
  BranchInfo,
  CurrentPr,
  DraftComment,
  Graph,
  GraphScope,
  ListState,
  MergeMethod,
  PrDetail,
  PrFiles,
  PrSummary,
  RepoInfo,
  RepoStatus,
  ReviewEvent,
} from "../types"

export type Api = ReturnType<typeof makeApi>

/** One RPC caller per plugin context; reads ctx.client on every call, as it changes after the server restarts. */
function makeCaller(ctx: Pick<Context, "client">) {
  return <T>(rpc: any, method: string, directory: string, input: object = {}) => {
    const client = ctx.client.rpc(rpc) as unknown as Record<string, (input: object, options: object) => Promise<T>>
    return client[method]({ directory, ...input }, { location: { directory } })
  }
}

export function makeApi(ctx: Pick<Context, "client">) {
  const call = makeCaller(ctx)
  const pr = <T>(method: keyof (typeof PrReview)["methods"], directory: string, input: object = {}) =>
    call<T>(PrReview, method, directory, input)

  return {
    repo: (dir: string) => pr<RepoInfo>("repo", dir),
    list: (dir: string, state: ListState) => pr<PrSummary[]>("list", dir, { state }),
    detail: (dir: string, number: number) => pr<PrDetail>("detail", dir, { number }),
    files: (dir: string, number: number) => pr<PrFiles>("files", dir, { number }),
    current: (dir: string) => pr<CurrentPr | null>("current", dir),
    setViewed: (dir: string, number: number, path: string, viewed: boolean) =>
      pr<null>("setViewed", dir, { number, path, viewed }),
    comment: (dir: string, number: number, body: string) => pr<null>("comment", dir, { number, body }),
    reply: (dir: string, number: number, commentID: number, body: string) =>
      pr<null>("reply", dir, { number, commentID, body }),
    submitReview: (
      dir: string,
      number: number,
      input: { event: ReviewEvent; body: string; commit: string; comments: DraftComment[] },
    ) =>
      pr<null>("submitReview", dir, {
        number,
        event: input.event,
        body: input.body,
        commit: input.commit,
        comments: input.comments.map(({ path, line, startLine, side, body }) => ({ path, line, startLine, side, body })),
      }),
    merge: (dir: string, number: number, method: MergeMethod) => pr<null>("merge", dir, { number, method }),
    checkout: (dir: string, number: number) => pr<null>("checkout", dir, { number }),
    ready: (dir: string, number: number) => pr<null>("ready", dir, { number }),
  }
}

export type GitApi = ReturnType<typeof makeGitApi>

export function makeGitApi(ctx: Pick<Context, "client">) {
  const call = makeCaller(ctx)

  return {
    repo: (dir: string) => call<RepoStatus>(Git, "repo", dir),
    branches: (dir: string) => call<BranchInfo[]>(Git, "branches", dir),
    graph: (dir: string, scope: GraphScope, limit: number) => call<Graph>(Git, "graph", dir, { scope, limit }),
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
