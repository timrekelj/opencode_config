// --- local git -------------------------------------------------------------------------------------------------------

export type GraphScope = "local" | "current" | "all"

export interface RepoStatus {
  nameWithOwner?: string
  url?: string
  /** The checked-out branch, or the short HEAD hash when detached. */
  branch: string
  detached: boolean
  hash: string
}

export interface BranchInfo {
  /** Short name: `dev` for local, `origin/dev` for remote. */
  name: string
  remote: boolean
  /** Checked out in this workspace (cwd). */
  current: boolean
  /** Checked out in another worktree of the same repository. */
  worktree: boolean
  /** Merged into HEAD (local branches only). */
  merged: boolean
  upstream?: string
  ahead: number
  behind: number
  commit: string
  subject: string
  author: string
  /** Unix seconds. */
  time: number
}

export interface GraphCommit {
  hash: string
  parents: string[]
  subject: string
  author: string
  /** Unix seconds. */
  time: number
  /** Decorations, e.g. `HEAD -> dev`, `origin/dev`, `tag: v1.0`. */
  refs: string[]
  head: boolean
}

export interface Graph {
  scope: GraphScope
  commits: GraphCommit[]
}
