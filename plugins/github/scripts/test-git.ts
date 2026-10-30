import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import * as git from "../src/git"
import { layoutGraph } from "../src/gui/graph"

const root = mkdtempSync(join(tmpdir(), "gg-test-"))
const origin = join(root, "origin.git")
const work = join(root, "work")
const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" }
const run = (args: string[]) => execFileSync("git", args, { cwd: work, env: ENV }).toString()
const commit = (msg: string) => run(["commit", "--allow-empty", "-m", msg])

execFileSync("git", ["init", "--bare", "-b", "main", origin])
execFileSync("git", ["init", "-b", "main", work])
run(["remote", "add", "origin", origin])
commit("c1 main")
run(["push", "-u", "origin", "main"])
run(["checkout", "-b", "dev"])
commit("c2 dev")
commit("c3 dev")
run(["checkout", "main"])
commit("c4 main")
run(["push", "origin", "main"])
run(["checkout", "dev"])
run(["merge", "--no-edit", "main"]) // merge commit with two parents
run(["tag", "v1.0"])
run(["checkout", "-b", "feature/x"])
commit("c6 feature")
run(["branch", "old-branch", "feature/x"]) // points at unmerged c6 for now
run(["checkout", "dev"])
run(["push", "-u", "origin", "dev"])
commit("c7 dev unpushed") // local dev now ahead of origin/dev by 1

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `ok   ${name}` : `FAIL ${name}`, cond ? "" : JSON.stringify(extra))
  if (!cond) failures++
}

// repo
const repo = await git.repo(work)
check("repo.branch=dev", repo.branch === "dev", repo)
run(["remote", "set-url", "origin", "git@github.com:acme/widgets.git"])
const repo2 = await git.repo(work)
check("repo.nameWithOwner=acme/widgets", repo2.nameWithOwner === "acme/widgets", repo2)
run(["remote", "set-url", "origin", origin])

// branches
const branches = await git.branches(work)
const names = branches.map((b) => b.name)
check("local branches", ["dev", "main", "feature/x", "old-branch"].every((n) => names.includes(n)), names)
check("remote branches", names.includes("origin/main") && names.includes("origin/dev"), names)
check("no origin/HEAD", !names.includes("origin/HEAD"), names)
const dev = branches.find((b) => b.name === "dev")!
check("dev.current", dev.current === true, dev)
check("dev.upstream=origin/dev", dev.upstream === "origin/dev", dev)
check("dev.merged", dev.merged === true, dev)
check("dev ahead 1 (c7 unpushed)", dev.ahead === 1 && dev.behind === 0, dev)
const old = branches.find((b) => b.name === "old-branch")!
check("old-branch not merged", old.merged === false, old)
const odev = branches.find((b) => b.name === "origin/dev")!
check("origin/dev shows local ahead 1", odev.remote && odev.ahead === 1 && odev.behind === 0, odev)
const omain = branches.find((b) => b.name === "origin/main")!
check("origin/main behind 1 vs main? main has c4 == origin/main so 0/0", omain.ahead === 0 && omain.behind === 0, omain)

// graph scopes
const gAll = await git.graph(work, "all", 100)
const gLocal = await git.graph(work, "local", 100)
const gCurrent = await git.graph(work, "current", 100)
check("graph all = 7 commits", gAll.commits.length === 7, gAll.commits.map((c) => c.subject))
check("graph local = 7", gLocal.commits.length === 7, gLocal.commits.length)
check("graph current (dev) = 6", gCurrent.commits.length === 6, gCurrent.commits.length)
const merge = gAll.commits.find((c) => c.parents.length === 2)
check("merge commit has 2 parents", !!merge, gAll.commits.map((c) => [c.subject, c.parents.length]))
const head = gAll.commits.find((c) => c.head)!
check("head decorated HEAD -> dev", head.refs.some((r) => r.startsWith("HEAD -> dev")), head.refs)
check("tag v1.0 decorated", gAll.commits.some((c) => c.refs.some((r) => r === "tag: v1.0")))
check("origin/dev decorated on merge commit", gAll.commits.some((c) => c.refs.includes("origin/dev") && c.subject.startsWith("Merge branch")))

// layout sanity
const layout = layoutGraph(gAll.commits)
check("layout rows == commits", layout.rows.length === gAll.commits.length)
check("layout lanes >= 2", layout.lanes >= 2, layout.lanes)
check("merge edge from different lane", layout.edges.some((e) => e.fromLane !== e.toLane), layout.edges)
check("edges never point at own row, lanes valid", layout.edges.every((e) => e.toRow !== e.fromRow && e.toLane < layout.lanes && e.fromLane < layout.lanes), layout.edges)
check("verticals within bounds", layout.verticals.every((v) => v.toRow <= layout.rows.length && v.lane < layout.lanes))
// Every parent is loaded, so no lane may run off the bottom: branches that share a fork point must end there.
check(
  "no line runs to the bottom when all parents are loaded",
  !layout.verticals.some((v) => v.toRow === layout.rows.length) && !layout.edges.some((e) => e.toRow >= layout.rows.length),
  layout.verticals.filter((v) => v.toRow === layout.rows.length),
)
// Two branch tips forked from the same commit (feature/x and old-branch both at c6, dev merged main) converge.
const converged = layoutGraph([
  { hash: "t1", parents: ["base"], subject: "", author: "", time: 3, refs: [], head: false },
  { hash: "t2", parents: ["base"], subject: "", author: "", time: 2, refs: [], head: false },
  { hash: "base", parents: [], subject: "", author: "", time: 1, refs: [], head: false },
])
check("sibling branches converge into their fork commit", converged.rows[2].lane === 0 && converged.edges.some((e) => e.fromLane === 1 && e.toLane === 0 && e.toRow === 2) && !converged.verticals.some((v) => v.toRow === 3), converged)
const gLim = await git.graph(work, "all", 3)
check("graph limit 3", gLim.commits.length === 3, gLim.commits.length)
const layoutLim = layoutGraph(gLim.commits)
check("truncated graph runs off bottom", layoutLim.edges.some((e) => e.toRow === gLim.commits.length) || layoutLim.verticals.some((v) => v.toRow === gLim.commits.length))

// show
const shown = await git.show(work, head.hash)
check("show contains message", shown.includes(head.subject), shown.slice(0, 80))

// actions
await git.rename(work, "old-branch-renamed", "old-branch")
check("rename", (await git.branches(work)).some((b) => b.name === "old-branch-renamed"))
await git.create(work, "from-feature", "feature/x")
check("create+checkout from-feature", (await git.repo(work)).branch === "from-feature")
await git.checkout(work, "dev")
check("checkout dev", (await git.repo(work)).branch === "dev")
await git.merge(work, "feature/x") // fast-forward: c6 lands on dev
check("merge ff brings c6", (await git.graph(work, "current", 50)).commits.some((c) => c.subject === "c6 feature"))
check("old-branch-renamed now merged", (await git.branches(work)).find((b) => b.name === "old-branch-renamed")!.merged === true)
await git.del(work, "old-branch-renamed", false) // merged: -d works
check("delete merged without force", !(await git.branches(work)).some((b) => b.name === "old-branch-renamed"))
run(["checkout", "-b", "tmp", "main"])
commit("c8 tmp only")
run(["checkout", "dev"])
run(["branch", "unmerged", "tmp"])
let delErr = ""
try { await git.del(work, "unmerged", false) } catch (e) { delErr = String(e) }
check("delete unmerged without force fails", /not fully merged|branch .-D/i.test(delErr), delErr)
await git.del(work, "unmerged", true)
check("delete unmerged with force", !(await git.branches(work)).some((b) => b.name === "unmerged"))
await git.fetch(work)
check("fetch ok", true)
await git.pull(work) // dev has unpushed c7 -> ff-only pull fails? pull --ff-only with ahead local... actually pull merges origin/dev into dev; local ahead -> ff ok
check("pull ok", true)
await git.push(work)
check("push ok (upstream exists)", true)
const afterPush = await git.branches(work)
check("dev ahead 0 after push", afterPush.find((b) => b.name === "dev")!.ahead === 0, afterPush.find((b) => b.name === "dev"))

// push without upstream
run(["checkout", "-b", "no-upstream"])
commit("c9 no-upstream")
await git.push(work)
check("push -u when no upstream", run(["rev-parse", "--abbrev-ref", "@{upstream}"]).trim() === "origin/no-upstream")
run(["checkout", "dev"])

// detached HEAD
run(["checkout", "main"])
const detached = await git.repo(work)
check("detached? main is a branch so not detached", detached.detached === false && detached.branch === "main")
run(["checkout", "HEAD~1"])
const det2 = await git.repo(work)
check("detached shows hash", det2.detached === true && /^[0-9a-f]{7}$/.test(det2.branch), det2)
let pushErr = ""
try { await git.push(work) } catch (e) { pushErr = String(e) }
check("push on detached fails cleanly", pushErr.includes("Detached HEAD"), pushErr)
run(["checkout", "dev"])

// not a repo
const notRepo = mkdtempSync(join(tmpdir(), "gg-norepo-"))
let repoErr = ""
try { await git.repo(notRepo) } catch (e) { repoErr = String(e) }
check("non-repo errors", repoErr.toLowerCase().includes("not a git repository"), repoErr)

// repo with no commits yet: empty graph, no error
const empty = mkdtempSync(join(tmpdir(), "gg-empty-"))
execFileSync("git", ["init", "-b", "main", empty])
check("empty repo graph is empty", (await git.graph(empty, "all", 100)).commits.length === 0)
check("empty repo branches are empty", (await git.branches(empty)).length === 0)
rmSync(empty, { recursive: true, force: true })

// invalid ref rejected
let refErr = ""
try { await git.checkout(work, "--help") } catch (e) { refErr = String(e) }
check("invalid ref rejected", refErr.includes("Invalid ref"), refErr)

rmSync(root, { recursive: true, force: true })
rmSync(notRepo, { recursive: true, force: true })
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
