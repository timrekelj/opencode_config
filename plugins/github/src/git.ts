import { spawn } from "node:child_process"
import type { BranchInfo, Graph, GraphCommit, GraphScope, RepoStatus } from "./types"

export class GitError extends Error {}

const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]

interface GitRunOptions {
  cwd: string
  signal?: AbortSignal
}

function git(args: string[], options: GitRunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const path = [process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(":")
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: { ...process.env, PATH: path, GIT_PAGER: "", PAGER: "cat", NO_COLOR: "1" },
      signal: options.signal,
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (err += chunk))
    child.on("error", (error) =>
      reject(
        new GitError(
          (error as NodeJS.ErrnoException).code === "ENOENT" ? "git was not found on PATH." : error.message,
        ),
      ),
    )
    child.on("close", (code) => {
      if (code === 0) return resolve(out)
      reject(new GitError(err.trim() || out.trim() || `git ${args[0]} exited with code ${code}`))
    })
    child.stdin.end()
  })
}

// --- reading ---------------------------------------------------------------------------------------------------------

const REF_RE = /^(?!-)[A-Za-z0-9._/-]+$/

function assertRef(ref: string) {
  if (!REF_RE.test(ref)) throw new GitError(`Invalid ref: ${ref}`)
}

function parseRemote(url: string): string | undefined {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url.trim())
  return match ? `${match[1]}/${match[2]}` : undefined
}

export async function repo(dir: string, signal?: AbortSignal): Promise<RepoStatus> {
  // Throws "not a git repository" for a non-repo directory, so the panel can show it as an error state.
  await git(["rev-parse", "--is-inside-work-tree"], { cwd: dir, signal })
  const url = (await git(["remote", "get-url", "origin"], { cwd: dir, signal }).catch(() => "")).trim()
  const branch = (await git(["branch", "--show-current"], { cwd: dir, signal }).catch(() => "")).trim()
  const hash = (await git(["rev-parse", "--short", "HEAD"], { cwd: dir, signal }).catch(() => "")).trim()
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
  const out = await git(["for-each-ref", `--format=${format}`, "refs/heads", "refs/remotes"], { cwd: dir, signal })
  const worktrees = await git(["worktree", "list", "--porcelain"], { cwd: dir, signal }).catch(() => "")
  const worktreeBranches = new Set([...worktrees.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]))
  const mergedOut = await git(["branch", "--merged", "HEAD", "--format=%(refname:short)"], { cwd: dir, signal }).catch(
    () => "",
  )
  const merged = new Set(mergedOut.split("\n").map((s) => s.trim()).filter(Boolean))

  const list: BranchInfo[] = []
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const [refname, name, upstream, track, head, commit, subject, author, time] = line.split("\x1f")
    const remote = refname.startsWith("refs/remotes/")
    if (remote && name.endsWith("/HEAD")) continue // symbolic ref like origin/HEAD
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
  const localNames = new Set(list.filter((b) => !b.remote).map((b) => b.name))
  for (const b of list) {
    if (!b.remote) continue
    const local = b.name.slice(b.name.indexOf("/") + 1)
    if (!localNames.has(local)) continue
    const counts = await git(["rev-list", "--left-right", "--count", `${local}...${b.name}`], {
      cwd: dir,
      signal,
    }).catch(() => "")
    const [ahead, behind] = counts.trim().split(/\s+/).map(Number)
    if (Number.isFinite(ahead) && Number.isFinite(behind)) {
      b.ahead = ahead
      b.behind = behind
    }
  }

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
  return git(["show", "--format=fuller", "--stat", "--no-renames", hash], { cwd: dir, signal })
}

// --- actions ---------------------------------------------------------------------------------------------------------

export function checkout(dir: string, ref: string, signal?: AbortSignal): Promise<string> {
  assertRef(ref)
  return git(["checkout", ref], { cwd: dir, signal })
}

export function create(dir: string, name: string, start: string, signal?: AbortSignal): Promise<string> {
  assertRef(name)
  if (start) assertRef(start)
  return git(["switch", "-c", name, ...(start ? [start] : [])], { cwd: dir, signal })
}

export function rename(dir: string, name: string, from: string | undefined, signal?: AbortSignal): Promise<string> {
  assertRef(name)
  if (from) assertRef(from)
  return git(["branch", "-m", ...(from ? [from] : []), name], { cwd: dir, signal })
}

export function del(dir: string, name: string, force: boolean, signal?: AbortSignal): Promise<string> {
  assertRef(name)
  return git(["branch", force ? "-D" : "-d", name], { cwd: dir, signal })
}

export function merge(dir: string, branch: string, signal?: AbortSignal): Promise<string> {
  assertRef(branch)
  return git(["merge", "--no-edit", branch], { cwd: dir, signal })
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
