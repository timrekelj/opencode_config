export type CheckState = "success" | "failure" | "pending" | "skipped" | "neutral"
export type Rollup = CheckState | "none"
export type PrState = "OPEN" | "CLOSED" | "MERGED"
export type ListState = "open" | "closed" | "merged" | "all"
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
export type MergeMethod = "squash" | "merge" | "rebase"
export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED"
export type Side = "LEFT" | "RIGHT"

export interface RepoInfo {
  nameWithOwner: string
  url: string
  defaultBranch: string
  viewer: string
}

export interface Label {
  name: string
  color: string
}

export interface Check {
  name: string
  workflow?: string
  state: CheckState
  url?: string
}

export interface PrSummary {
  number: number
  title: string
  author: string
  head: string
  base: string
  draft: boolean
  state: PrState
  reviewDecision: ReviewDecision
  updatedAt: string
  url: string
  additions: number
  deletions: number
  checks: Rollup
  reviewRequested: boolean
  labels: Label[]
}

export interface Reviewer {
  login: string
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | "REQUESTED"
}

export type TimelineItem =
  | { kind: "comment"; id: string; author: string; createdAt: string; body: string; url?: string }
  | { kind: "review"; id: string; author: string; createdAt: string; body: string; state: string }
  | { kind: "commit"; id: string; author: string; createdAt: string; message: string }

export interface PrDetail extends PrSummary {
  id: string
  body: string
  createdAt: string
  headOid: string
  mergeable: string
  mergeStateStatus: string
  changedFiles: number
  crossRepository: boolean
  checkList: Check[]
  reviewers: Reviewer[]
  timeline: TimelineItem[]
}

export interface PrFile {
  path: string
  previous?: string
  status: string
  additions: number
  deletions: number
  patch?: string
  viewed: ViewedState
}

export interface ReviewComment {
  id: number
  path: string
  line: number | null
  startLine: number | null
  side: Side
  body: string
  author: string
  createdAt: string
  replyTo: number | null
  url: string
}

export interface PrFiles {
  files: PrFile[]
  comments: ReviewComment[]
}

export interface DraftComment {
  id: string
  path: string
  line: number
  startLine?: number
  side: Side
  body: string
}

export interface CurrentPr {
  number: number
  title: string
  url: string
  state: PrState
  checks: Rollup
  reviewDecision: ReviewDecision
}
