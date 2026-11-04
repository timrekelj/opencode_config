import { run, RunError } from "./run"
import type { BranchInfo, Graph, GraphCommit, GraphScope, RepoStatus } from "./types"

export class GitError extends Error {}

interface GitRunOptions {
  cwd: string
  signal?: AbortSignal
}

function git(args: string[], options: GitRunOptions): Promise<string> {
  return run("git", args, { ...options, env: { GIT_PAGER: "", PAGER: "cat" } }).catch((error) => {
    throw new GitError(error instanceof RunError && error.notFound ? "git was not found on PATH." : error.message)
  })
}

// --- reading ---------------------------------------------------------------------------------------------------------

// Git validates ref names itself; this only rejects what could be read as an option or a range.
// Refs are also passed after `--end-of-options` where the subcommand takes them positionally.
function assertRef(ref: string) {
  if (!ref || ref.startsWith("-") || ref.includes("..") || /[\x00-\x1f\x7f]/.test(ref))
    throw new GitError(`Invalid ref: ${ref}`)
}

function parseRemote(url: string): string | undefined {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url.trim())
  return match ? `${match[1]}/${match[2]}` : undefined
}

export async function repo(dir: string, signal?: AbortSignal): Promise<RepoStatus> {
  // Throws "not a git repository" for a non-repo directory, so the panel can show it as an error state.
  const [, url, branch, hash] = (
    await Promise.all([
      git(["rev-parse", "--is-inside-work-tree"], { cwd: dir, signal }),
      git(["remote", "get-url", "origin"], { cwd: dir, signal }).catch(() => ""),
      git(["branch", "--show-current"], { cwd: dir, signal }).catch(() => ""),
      git(["rev-parse", "--short", "HEAD"], { cwd: dir, signal }).catch(() => ""),
    ])
  ).map((s) => s.trim())
  return { nameWithOwner: parseRemote(url), url: url || undefined, branch: branch || hash || "HEAD", detached: !branch, hash }
}

export async function branches(dir: string, signal?: AbortSignal): Promise<BranchInfo[]> {
  const format = [
    "%(refname)",
    "%(refname:short)",
    "%(upstream:short)",
    "%(upstream:track)",
    "%(HEAD)",
    "%(objectname:short)",
    "%(subject)",
    "%(authorname)",
    "%(authordate:unix)",
  ].join("%1f")
  const [out, worktrees, mergedOut] = await Promise.all([
    git(["for-each-ref", `--format=${format}`, "refs/heads", "refs/remotes"], { cwd: dir, signal }),
    git(["worktree", "list", "--porcelain"], { cwd: dir, signal }).catch(() => ""),
    git(["branch", "--merged", "HEAD", "--format=%(refname:short)"], { cwd: dir, signal }).catch(() => ""),
  ])
  const worktreeBranches = new Set([...worktrees.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]))
  const merged = new Set(mergedOut.split("\n").map((s) => s.trim()).filter(Boolean))

  const list: BranchInfo[] = []
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const [refname, name, upstream, track, head, commit, subject, author, time] = line.split("\x1f")
    const remote = refname.startsWith("refs/remotes/")
    // Symbolic refs/remotes/<remote>/HEAD; its short name is just "<remote>", so match the full refname.
    if (remote && refname.endsWith("/HEAD")) continue
    const current = head === "*"
    const trackMatch = /ahead (\d+)(?:, behind (\d+))?|behind (\d+)/.exec(track)
    list.push({
      name,
      remote,
      current,
      worktree: !remote && !current && worktreeBranches.has(name),
      merged: !remote && merged.has(name),
      upstream: upstream || undefined,
      ahead: trackMatch ? Number(trackMatch[1] ?? 0) : 0,
      behind: trackMatch ? Number(trackMatch[2] ?? trackMatch[3] ?? 0) : 0,
      commit,
      subject: subject ?? "",
      author: author ?? "",
      time: Number(time ?? 0),
    })
  }
  // Remote branches have no upstream of their own; show how the same-named local branch relates to them.
  // A local branch tracking that remote branch already has the counts from %(upstream:track).
  const locals = new Map(list.filter((b) => !b.remote).map((b) => [b.name, b]))
  await Promise.all(
    list.map(async (b) => {
      if (!b.remote) return
      const local = locals.get(b.name.slice(b.name.indexOf("/") + 1))
      if (!local) return
      if (local.upstream === b.name) {
        b.ahead = local.ahead
        b.behind = local.behind
        return
      }
      const counts = await git(
        ["rev-list", "--left-right", "--count", "--end-of-options", `${local.name}...${b.name}`],
        { cwd: dir, signal },
      ).catch(() => "")
      const [ahead, behind] = counts.trim().split(/\s+/).map(Number)
      if (Number.isFinite(ahead) && Number.isFinite(behind)) {
        b.ahead = ahead
        b.behind = behind
      }
    }),
  )

  const rank = (b: BranchInfo) => (b.current ? 0 : b.remote ? 2 : 1)
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export async function graph(dir: string, scope: GraphScope, limit: number, signal?: AbortSignal): Promise<Graph> {
  // A repo with no commits yet has no HEAD: report an empty graph instead of git log's error.
  const hasHead = await git(["rev-parse", "--verify", "HEAD"], { cwd: dir, signal }).then(
    () => true,
    () => false,
  )
  if (!hasHead) return { scope, commits: [] }
  const refs = scope === "local" ? ["--branches"] : scope === "current" ? ["HEAD"] : ["--all"]
  const out = await git(
    [
      "log",
      ...refs,
      `--max-count=${Math.max(1, Math.floor(limit))}`,
      "--decorate=short",
      "--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1f%D%x1e",
    ],
    { cwd: dir, signal },
  )
  const commits: GraphCommit[] = []
  for (const record of out.split("\x1e")) {
    const line = record.replace(/^\r?\n/, "").replace(/\r?\n$/, "")
    if (!line) continue
    const [hash, parents, author, time, subject, decorate] = line.split("\x1f")
    if (!hash) continue
    const refs = (decorate ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    commits.push({
      hash,
      parents: (parents ?? "").split(" ").filter(Boolean),
      subject: subject ?? "",
      author: author ?? "",
      time: Number(time ?? 0),
      refs,
      head: refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> ")),
    })
  }
  return { scope, commits }
}

export function show(dir: string, hash: string, signal?: AbortSignal): Promise<string> {
  assertRef(hash)
  return git(["show", "--format=fuller", "--stat", "--no-renames", "--end-of-options", hash], { cwd: dir, signal })
}

// --- actions ---------------------------------------------------------------------------------------------------------

export function checkout(dir: string, ref: string, signal?: AbortSignal): Promise<string> {
  assertRef(ref)
  // `git switch` only takes branches, unlike `git checkout`, which falls back to a pathspec and discards edits.
  return git(["switch", "--end-of-options", ref], { cwd: dir, signal })
}

export function create(dir: string, name: string, start: string, signal?: AbortSignal): Promise<string> {
  assertRef(name)
  if (start) assertRef(start)
  return git(["switch", "-c", name, "--end-of-options", ...(start ? [start] : [])], { cwd: dir, signal })
}

export function rename(dir: string, name: string, from: string | undefined, signal?: AbortSignal): Promise<string> {
  assertRef(name)
  if (from) assertRef(from)
  return git(["branch", "-m", "--end-of-options", ...(from ? [from] : []), name], { cwd: dir, signal })
}

export function del(dir: string, name: string, force: boolean, signal?: AbortSignal): Promise<string> {
  assertRef(name)
  return git(["branch", force ? "-D" : "-d", "--end-of-options", name], { cwd: dir, signal })
}

export function merge(dir: string, branch: string, signal?: AbortSignal): Promise<string> {
  assertRef(branch)
  return git(["merge", "--no-edit", "--end-of-options", branch], { cwd: dir, signal })
}

export function fetch(dir: string, signal?: AbortSignal): Promise<string> {
  return git(["fetch", "--all", "--prune"], { cwd: dir, signal })
}

export function pull(dir: string, signal?: AbortSignal): Promise<string> {
  return git(["pull", "--ff-only"], { cwd: dir, signal })
}

export async function push(dir: string, signal?: AbortSignal): Promise<string> {
  const current = (await git(["branch", "--show-current"], { cwd: dir, signal })).trim()
  if (!current) throw new GitError("Detached HEAD: there is no current branch to push.")
  const upstream = (await git(["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: dir, signal }).catch(() => "")).trim()
  return upstream
    ? git(["push"], { cwd: dir, signal })
    : git(["push", "-u", "origin", current], { cwd: dir, signal })
}
