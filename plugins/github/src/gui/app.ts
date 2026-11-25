import type { Context, SessionRef } from "@opencode/plugin/gui"
import type { GitApi } from "./api"

export const BRANCHES_TAB = "branches"

export interface App {
  ctx: Context
  git: GitApi
  /** Commit graph size cap, from the plugin's `limit` option. */
  graphLimit: number
  openBranches(session: SessionRef): void
  /** Reactive tick the composer pill reads; bump it after branch actions. */
  branchTick: () => number
  bumpBranch(): void
}
