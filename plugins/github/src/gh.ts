import { run, RunError } from "./run"
import type {
  Check,
  CheckState,
  CurrentPr,
  Label,
  ListState,
  PrDetail,
  PrFiles,
  PrState,
  PrSummary,
  RepoInfo,
  ReviewComment,
  ReviewDecision,
  Reviewer,
  Rollup,
  TimelineItem,
  ViewedState,
} from "./types"

export class GhError extends Error {}

interface GhOptions {
  bin: string
  cwd: string
  input?: string
  signal?: AbortSignal
}

export function gh(args: string[], options: GhOptions): Promise<string> {
  return run(options.bin, args, {
    cwd: options.cwd,
    env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    input: options.input,
    signal: options.signal,
  }).catch((error) => {
    throw new GhError(
      error instanceof RunError && error.notFound
        ? "GitHub CLI (gh) was not found. Install it and run `gh auth login`."
        : error.message,
    )
  })
}

const ghJson = async <T>(args: string[], options: GhOptions): Promise<T> => JSON.parse(await gh(args, options)) as T

/** `gh api` targets the default host, not the cwd's remote: pass the repository's host for GitHub Enterprise. */
const hostArgs = (url: string) => {
  const host = new URL(url).hostname
  return host === "github.com" ? [] : ["--hostname", host]
}

// --- normalization -------------------------------------------------------------------------------------------------

interface RawCheck {
  __typename: "CheckRun" | "StatusContext"
  name?: string
  workflowName?: string
  status?: string
  conclusion?: string
  detailsUrl?: string
  context?: string
  state?: string
  targetUrl?: string
}

const checkState = (raw: RawCheck): CheckState => {
  if (raw.__typename === "StatusContext") {
    if (raw.state === "SUCCESS") return "success"
    if (raw.state === "FAILURE" || raw.state === "ERROR") return "failure"
    return "pending"
  }
  if (raw.status !== "COMPLETED") return "pending"
  switch (raw.conclusion) {
    case "SUCCESS":
      return "success"
    case "SKIPPED":
      return "skipped"
    case "NEUTRAL":
      return "neutral"
    default:
      return "failure"
  }
}

const toCheck = (raw: RawCheck): Check => ({
  name: raw.name ?? raw.context ?? "check",
  workflow: raw.workflowName || undefined,
  state: checkState(raw),
  url: raw.detailsUrl ?? raw.targetUrl,
})

const rollup = (checks: Check[]): Rollup => {
  if (checks.length === 0) return "none"
  if (checks.some((c) => c.state === "failure")) return "failure"
  if (checks.some((c) => c.state === "pending")) return "pending"
  if (checks.some((c) => c.state === "success")) return "success"
  return "neutral"
}

interface RawPr {
  id: string
  number: number
  title: string
  author: { login: string } | null
  headRefName: string
  baseRefName: string
  isDraft: boolean
  state: PrState
  reviewDecision: string
  updatedAt: string
  url: string
  additions: number
  deletions: number
  statusCheckRollup: RawCheck[] | null
  reviewRequests: { __typename: string; login?: string; name?: string; slug?: string }[]
  labels: Label[]
}

const SUMMARY_FIELDS = [
  "number",
  "title",
  "author",
  "headRefName",
  "baseRefName",
  "isDraft",
  "state",
  "reviewDecision",
  "updatedAt",
  "url",
  "additions",
  "deletions",
  "statusCheckRollup",
  "reviewRequests",
  "labels",
]

const decision = (value: string): ReviewDecision =>
  value === "APPROVED" || value === "CHANGES_REQUESTED" || value === "REVIEW_REQUIRED" ? value : null

const toSummary = (raw: RawPr, viewer: string): PrSummary => ({
  number: raw.number,
  title: raw.title,
  author: raw.author?.login ?? "ghost",
  head: raw.headRefName,
  base: raw.baseRefName,
  draft: raw.isDraft,
  state: raw.state,
  reviewDecision: decision(raw.reviewDecision),
  updatedAt: raw.updatedAt,
  url: raw.url,
  additions: raw.additions,
  deletions: raw.deletions,
  checks: rollup((raw.statusCheckRollup ?? []).map(toCheck)),
  reviewRequested: (raw.reviewRequests ?? []).some((r) => r.login === viewer),
  labels: raw.labels ?? [],
})

// --- repository -----------------------------------------------------------------------------------------------------

export class GitHub {
  private repos = new Map<string, Promise<RepoInfo>>()
  /** GraphQL node ids by `${cwd}#${number}`, for the viewed-file mutations. */
  private nodeIds = new Map<string, string>()
  /** Signed-in user by host. */
  private viewers = new Map<string, Promise<string>>()

  constructor(
    private bin: string,
    private limit = 40,
  ) {}

  private run(cwd: string, args: string[], input?: string, signal?: AbortSignal) {
    return gh(args, { bin: this.bin, cwd, input, signal })
  }

  private json<T>(cwd: string, args: string[], input?: string, signal?: AbortSignal) {
    return ghJson<T>(args, { bin: this.bin, cwd, input, signal })
  }

  private login(cwd: string, url: string) {
    const host = new URL(url).hostname
    const cached = this.viewers.get(host)
    if (cached) return cached
    const next = this.run(cwd, ["api", ...hostArgs(url), "user", "--jq", ".login"]).then((out) => out.trim())
    next.catch(() => this.viewers.delete(host))
    this.viewers.set(host, next)
    return next
  }

  repo(cwd: string): Promise<RepoInfo> {
    const cached = this.repos.get(cwd)
    if (cached) return cached
    const next = this.json<{ nameWithOwner: string; url: string }>(cwd, [
      "repo",
      "view",
      "--json",
      "nameWithOwner,url",
    ]).then(async (repo) => ({
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      viewer: await this.login(cwd, repo.url),
    }))
    next.catch(() => this.repos.delete(cwd))
    this.repos.set(cwd, next)
    return next
  }

  async list(cwd: string, state: ListState, signal?: AbortSignal): Promise<PrSummary[]> {
    const repo = await this.repo(cwd)
    const raw = await this.json<RawPr[]>(
      cwd,
      ["pr", "list", "--state", state, "--limit", String(this.limit), "--json", SUMMARY_FIELDS.join(",")],
      undefined,
      signal,
    )
    return raw.map((pr) => toSummary(pr, repo.viewer))
  }

  async current(cwd: string, signal?: AbortSignal): Promise<CurrentPr | null> {
    try {
      const raw = await this.json<RawPr>(
        cwd,
        ["pr", "view", "--json", "number,title,url,state,statusCheckRollup,reviewDecision"],
        undefined,
        signal,
      )
      return {
        number: raw.number,
        title: raw.title,
        url: raw.url,
        state: raw.state,
        checks: rollup((raw.statusCheckRollup ?? []).map(toCheck)),
        reviewDecision: decision(raw.reviewDecision),
      }
    } catch (error) {
      if (
        error instanceof GhError &&
        /no pull requests found|not a git repository|no git remotes|could not determine current branch|not on any branch/i.test(
          error.message,
        )
      )
        return null
      throw error
    }
  }

  async detail(cwd: string, number: number, signal?: AbortSignal): Promise<PrDetail> {
    const repo = await this.repo(cwd)
    const raw = await this.json<
      RawPr & {
        body: string
        createdAt: string
        headRefOid: string
        mergeable: string
        mergeStateStatus: string
        changedFiles: number
        latestReviews: { author: { login: string } | null; state: string }[]
        reviews: { id: string; author: { login: string } | null; body: string; submittedAt: string; state: string }[]
        comments: { id: string; author: { login: string } | null; body: string; createdAt: string; url: string }[]
        commits: { oid: string; messageHeadline: string; committedDate: string; authors: { login: string; name: string }[] }[]
      }
    >(
      cwd,
      [
        "pr",
        "view",
        String(number),
        "--json",
        [
          ...SUMMARY_FIELDS,
          "id",
          "body",
          "createdAt",
          "headRefOid",
          "mergeable",
          "mergeStateStatus",
          "changedFiles",
          "latestReviews",
          "reviews",
          "comments",
          "commits",
        ].join(","),
      ],
      undefined,
      signal,
    )

    const checkList = (raw.statusCheckRollup ?? []).map(toCheck)
    const reviewers = new Map<string, Reviewer>()
    for (const request of raw.reviewRequests ?? []) {
      const login = request.login ?? request.slug ?? request.name
      if (login) reviewers.set(login, { login, state: "REQUESTED" })
    }
    for (const review of raw.latestReviews ?? []) {
      const login = review.author?.login
      if (login && !reviewers.has(login)) reviewers.set(login, { login, state: review.state as Reviewer["state"] })
    }

    const timeline: TimelineItem[] = [
      ...(raw.comments ?? []).map(
        (c): TimelineItem => ({
          kind: "comment",
          id: c.id,
          author: c.author?.login ?? "ghost",
          createdAt: c.createdAt,
          body: c.body,
          url: c.url,
        }),
      ),
      ...(raw.reviews ?? [])
        // Inline comments and thread replies arrive as empty COMMENTED reviews; they show in the Files tab instead.
        .filter((r) => r.state !== "PENDING" && !(r.state === "COMMENTED" && !r.body.trim()))
        .map(
          (r): TimelineItem => ({
            kind: "review",
            id: r.id,
            author: r.author?.login ?? "ghost",
            createdAt: r.submittedAt,
            body: r.body,
            state: r.state,
          }),
        ),
      ...(raw.commits ?? []).map(
        (c): TimelineItem => ({
          kind: "commit",
          id: c.oid,
          author: c.authors[0]?.login || c.authors[0]?.name || "unknown",
          createdAt: c.committedDate,
          message: c.messageHeadline,
        }),
      ),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    this.nodeIds.set(`${cwd}#${number}`, raw.id)
    return {
      ...toSummary(raw, repo.viewer),
      viewer: repo.viewer,
      body: raw.body,
      createdAt: raw.createdAt,
      headOid: raw.headRefOid,
      mergeable: raw.mergeable,
      mergeStateStatus: raw.mergeStateStatus,
      changedFiles: raw.changedFiles,
      checkList,
      reviewers: [...reviewers.values()],
      timeline,
    }
  }

  async files(cwd: string, number: number, signal?: AbortSignal): Promise<PrFiles> {
    const repo = await this.repo(cwd)
    const [owner, name] = repo.nameWithOwner.split("/")
    const base = `repos/${repo.nameWithOwner}/pulls/${number}`

    const [pages, commentPages, viewed] = await Promise.all([
      this.json<
        { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string }[][]
      >(cwd, ["api", ...hostArgs(repo.url), `${base}/files?per_page=100`, "--paginate", "--slurp"], undefined, signal),
      this.json<
        {
          id: number
          path: string
          line: number | null
          start_line: number | null
          original_line: number | null
          side: "LEFT" | "RIGHT"
          body: string
          user: { login: string } | null
          created_at: string
          in_reply_to_id?: number
          html_url: string
        }[][]
      >(
        cwd,
        ["api", ...hostArgs(repo.url), `${base}/comments?per_page=100`, "--paginate", "--slurp"],
        undefined,
        signal,
      ),
      this.viewedStates(cwd, repo, owner, name, number, signal).catch(() => new Map<string, ViewedState>()),
    ])

    return {
      files: pages.flat().map((f) => ({
        path: f.filename,
        previous: f.previous_filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
        viewed: viewed.get(f.filename) ?? "UNVIEWED",
      })),
      comments: commentPages.flat().map(
        (c): ReviewComment => ({
          id: c.id,
          path: c.path,
          line: c.line,
          startLine: c.start_line,
          originalLine: c.original_line,
          side: c.side ?? "RIGHT",
          body: c.body,
          author: c.user?.login ?? "ghost",
          createdAt: c.created_at,
          replyTo: c.in_reply_to_id ?? null,
          url: c.html_url,
        }),
      ),
    }
  }

  private async viewedStates(
    cwd: string,
    repo: RepoInfo,
    owner: string,
    name: string,
    number: number,
    signal?: AbortSignal,
  ) {
    const query = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          files(first: 100, after: $endCursor) {
            pageInfo { hasNextPage endCursor }
            nodes { path viewerViewedState }
          }
        }
      }
    }`
    const pages = await this.json<
      { data: { repository: { pullRequest: { files: { nodes: { path: string; viewerViewedState: ViewedState }[] } } } } }[]
    >(
      cwd,
      [
        "api",
        ...hostArgs(repo.url),
        "graphql",
        "--paginate",
        "--slurp",
        // -f sends strings verbatim; -F would read `@file` and coerce true/false/null/numbers.
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-F",
        `number=${number}`,
        "-f",
        `query=${query}`,
      ],
      undefined,
      signal,
    )
    const result = new Map<string, ViewedState>()
    for (const page of pages)
      for (const node of page.data.repository.pullRequest.files.nodes) result.set(node.path, node.viewerViewedState)
    return result
  }

  async setViewed(cwd: string, number: number, path: string, viewed: boolean) {
    const repo = await this.repo(cwd)
    const key = `${cwd}#${number}`
    const id =
      this.nodeIds.get(key) ?? (await this.json<{ id: string }>(cwd, ["pr", "view", String(number), "--json", "id"])).id
    this.nodeIds.set(key, id)
    const mutation = viewed ? "markFileAsViewed" : "unmarkFileAsViewed"
    await this.run(cwd, [
      "api",
      ...hostArgs(repo.url),
      "graphql",
      "-f",
      `query=mutation($id: ID!, $path: String!) { ${mutation}(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`,
      "-f",
      `id=${id}`,
      "-f",
      `path=${path}`,
    ])
  }

  async comment(cwd: string, number: number, body: string) {
    await this.run(cwd, ["pr", "comment", String(number), "--body-file", "-"], body)
  }

  async reply(cwd: string, number: number, commentID: number, body: string) {
    const repo = await this.repo(cwd)
    await this.run(
      cwd,
      [
        "api",
        ...hostArgs(repo.url),
        "-X",
        "POST",
        `repos/${repo.nameWithOwner}/pulls/${number}/comments/${commentID}/replies`,
        "--input",
        "-",
      ],
      JSON.stringify({ body }),
    )
  }

  async submitReview(
    cwd: string,
    input: {
      number: number
      event: string
      body?: string
      commit: string
      comments?: { path: string; line: number; startLine?: number; side: string; body: string }[]
    },
  ) {
    const repo = await this.repo(cwd)
    const payload = {
      commit_id: input.commit,
      event: input.event,
      body: input.body || undefined,
      comments: (input.comments ?? []).map((c) => ({
        path: c.path,
        line: c.line,
        side: c.side,
        body: c.body,
        ...(c.startLine && c.startLine !== c.line ? { start_line: c.startLine, start_side: c.side } : {}),
      })),
    }
    await this.run(
      cwd,
      [
        "api",
        ...hostArgs(repo.url),
        "-X",
        "POST",
        `repos/${repo.nameWithOwner}/pulls/${input.number}/reviews`,
        "--input",
        "-",
      ],
      JSON.stringify(payload),
    )
  }

  async merge(cwd: string, number: number, method: string) {
    if (!["squash", "merge", "rebase"].includes(method)) throw new GhError(`Unknown merge method: ${method}`)
    await this.run(cwd, ["pr", "merge", String(number), `--${method}`])
  }

  async checkout(cwd: string, number: number) {
    await this.run(cwd, ["pr", "checkout", String(number)])
  }

  async ready(cwd: string, number: number) {
    await this.run(cwd, ["pr", "ready", String(number)])
  }
}
