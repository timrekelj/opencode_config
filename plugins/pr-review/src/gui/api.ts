import type { Context } from "@opencode/plugin/gui"
import { PrReview } from "../rpc"
import type {
  CurrentPr,
  DraftComment,
  ListState,
  MergeMethod,
  PrDetail,
  PrFiles,
  PrSummary,
  RepoInfo,
  ReviewEvent,
} from "../types"

export type Api = ReturnType<typeof makeApi>

export function makeApi(ctx: Pick<Context, "client">) {
  const call = <T>(method: keyof (typeof PrReview)["methods"], directory: string, input: object = {}) => {
    // Read ctx.client on every call: it changes after the server restarts.
    const client = ctx.client.rpc(PrReview) as unknown as Record<string, (input: object, options: object) => Promise<T>>
    return client[method]({ directory, ...input }, { location: { directory } })
  }

  return {
    repo: (dir: string) => call<RepoInfo>("repo", dir),
    list: (dir: string, state: ListState) => call<PrSummary[]>("list", dir, { state }),
    detail: (dir: string, number: number) => call<PrDetail>("detail", dir, { number }),
    files: (dir: string, number: number) => call<PrFiles>("files", dir, { number }),
    current: (dir: string) => call<CurrentPr | null>("current", dir),
    setViewed: (dir: string, number: number, path: string, viewed: boolean) =>
      call<null>("setViewed", dir, { number, path, viewed }),
    comment: (dir: string, number: number, body: string) => call<null>("comment", dir, { number, body }),
    reply: (dir: string, number: number, commentID: number, body: string) =>
      call<null>("reply", dir, { number, commentID, body }),
    submitReview: (
      dir: string,
      number: number,
      input: { event: ReviewEvent; body: string; commit: string; comments: DraftComment[] },
    ) =>
      call<null>("submitReview", dir, {
        number,
        event: input.event,
        body: input.body,
        commit: input.commit,
        comments: input.comments.map(({ path, line, startLine, side, body }) => ({ path, line, startLine, side, body })),
      }),
    merge: (dir: string, number: number, method: MergeMethod) => call<null>("merge", dir, { number, method }),
    checkout: (dir: string, number: number) => call<null>("checkout", dir, { number }),
    ready: (dir: string, number: number) => call<null>("ready", dir, { number }),
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
