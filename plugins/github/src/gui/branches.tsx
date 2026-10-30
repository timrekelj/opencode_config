import { createLatest, type DialogHandle, type MountedSession } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { BranchInfo, GraphCommit, GraphScope } from "../types"
import type { App } from "./app"
import { errorMessage } from "./api"
import { ErrorState, showErrorToast } from "./errors"
import { edgePath, laneColor, layoutGraph, ROW_H } from "./graph"
import { ago, ellipsizeMiddle } from "./util"

const SCOPES: { value: GraphScope; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "current", label: "Current" },
  { value: "all", label: "All" },
]

const agoUnix = (time: number) => ago(new Date(time * 1000).toISOString())

/** Command-palette and composer-pill flows, shared with the panel. */

/** Checks out a branch row: locals via `git checkout`, remotes via a new local tracking branch (never detached). */
export async function switchTo(app: App, dir: string, b: BranchInfo) {
  if (b.current) return
  if (b.remote) {
    const local = b.name.slice(b.name.indexOf("/") + 1)
    await runAction(app, dir, "Checkout", () => app.git.create(dir, local, b.name), `Created ${local} tracking ${b.name}`)
  } else {
    await runAction(app, dir, "Checkout", () => app.git.checkout(dir, b.name), `Switched to ${b.name}`)
  }
}

export async function checkoutFlow(app: App, session: MountedSession) {
  const ctx = app.ctx
  const dir = session.directory
  const loading = ctx.toast.show({ variant: "loading", title: "Loading branches…", persistent: true })
  try {
    const branches = await app.git.branches(dir)
    loading.dismiss()
    const current = branches.find((b) => b.current)?.name
    const picked = await ctx.dialogs.select({
      title: "Checkout branch",
      placeholder: "Search branches",
      current,
      options: branches.map((b) => ({
        title: b.name,
        description: `${b.subject} — ${b.author}`,
        value: b.name,
        group: b.remote ? "Remote" : "Local",
      })),
    })
    if (picked === undefined || picked === current) return
    const branch = branches.find((b) => b.name === picked)
    if (branch) await switchTo(app, dir, branch)
  } catch (error) {
    loading.dismiss()
    showErrorToast(ctx, "Loading branches", error, dir)
  }
}

export async function newBranchFlow(app: App, session: MountedSession) {
  const ctx = app.ctx
  const dir = session.directory
  const name = await ctx.dialogs.prompt({
    title: "New branch",
    placeholder: "feature/my-change",
    description: "The branch is created and checked out from the start point you pick.",
  })
  if (name === undefined) return
  const branches = await app.git.branches(dir).catch(() => [] as BranchInfo[])
  const start = await ctx.dialogs.select({
    title: "Start from",
    placeholder: "Search branches and refs",
    options: [
      { title: "HEAD (current commit)", value: "" },
      ...branches.map((b) => ({ title: b.name, description: b.subject, value: b.name })),
    ],
  })
  if (start === undefined) return
  await runAction(app, dir, "Create branch", () => app.git.create(dir, name, start), `Created and switched to ${name}`)
}

async function runAction(app: App, dir: string, action: string, fn: () => Promise<unknown>, success?: string) {
  const toast = app.ctx.toast.show({ variant: "loading", title: `${action}…`, persistent: true })
  try {
    await fn()
    toast.dismiss()
    if (success) app.ctx.toast.show({ variant: "success", title: success })
    app.bumpBranch()
  } catch (error) {
    toast.dismiss()
    showErrorToast(app.ctx, action, error, dir)
  }
}

// --- the panel -------------------------------------------------------------------------------------------------------

export function BranchesView(props: { app: App; session: MountedSession }) {
  const ui = props.app.ctx.ui
  const ctx = props.app.ctx
  const dir = () => props.session.directory
  const [version, setVersion] = createSignal(0)
  const [scope, setScope] = createSignal<GraphScope>("all")
  const [query, setQuery] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [showRemotes, setShowRemotes] = createSignal(false)

  const refresh = () => setVersion((v) => v + 1)

  const repo = createLatest(() => `${dir()}\n${version()}\n${props.app.branchTick()}`, (key) =>
    props.app.git.repo(key.split("\n")[0]),
  )
  const branches = createLatest(
    () => `${dir()}\n${version()}\n${props.app.branchTick()}`,
    (key) => props.app.git.branches(key.split("\n")[0]),
  )
  const graph = createLatest(
    () => (branches.latest && !branches.error ? `${dir()}\n${scope()}\n${version()}\n${props.app.branchTick()}` : undefined),
    (key) => {
      const [d, s] = key.split("\n")
      return props.app.git.graph(d, s as GraphScope, props.app.graphLimit)
    },
  )

  const locals = createMemo(() => (branches.latest ?? []).filter((b) => !b.remote))
  const remotes = createMemo(() => (branches.latest ?? []).filter((b) => b.remote))

  const filteredBranches = createMemo(() => {
    const q = query().trim().toLowerCase()
    return (branches.latest ?? []).filter((b) => {
      if (b.remote && !showRemotes()) return false
      if (!q) return true
      return b.name.toLowerCase().includes(q) || b.subject.toLowerCase().includes(q)
    })
  })

  const filteredCommits = createMemo(() => {
    const q = query().trim().toLowerCase()
    const list = graph.latest?.commits ?? []
    if (!q) return list
    return list.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.hash.startsWith(q) ||
        c.author.toLowerCase().includes(q) ||
        c.refs.some((r) => r.toLowerCase().includes(q)),
    )
  })

  const layout = createMemo(() => layoutGraph(filteredCommits()))

  const failure = () => repo.error ?? branches.error
  const loading = () => repo.loading || branches.loading

  const run = async (action: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try {
      // runAction bumps app.branchTick(), which every createLatest key reads: one refresh round per action.
      await runAction(props.app, dir(), action, fn, success)
    } finally {
      setBusy(false)
    }
  }

  const checkoutBranch = (b: BranchInfo) => {
    void switchTo(props.app, dir(), b)
  }

  const newBranch = async () => {
    await newBranchFlow(props.app, props.session)
    refresh()
  }

  const renameBranch = async (b: BranchInfo) => {
    const name = await ctx.dialogs.prompt({ title: `Rename ${b.name}`, value: b.name, placeholder: "new-name" })
    if (name === undefined || name === b.name) return
    await run("Rename branch", () => props.app.git.rename(dir(), name, b.current ? undefined : b.name), `Renamed to ${name}`)
  }

  const deleteBranch = async (b: BranchInfo) => {
    const ok = await ctx.dialogs.confirm({
      title: `Delete ${b.name}?`,
      description: b.merged
        ? "The branch is merged into the current branch; deleting it loses no commits."
        : "The branch is NOT merged into the current branch; deleting it discards its unmerged commits.",
      confirm: "Delete",
      danger: true,
    })
    if (!ok) return
    await run("Delete branch", () => props.app.git.delete(dir(), b.name, !b.merged), `Deleted ${b.name}`)
  }

  const mergeBranch = async (b: BranchInfo) => {
    if (b.current) return
    const current = locals().find((x) => x.current)?.name ?? "HEAD"
    const ok = await ctx.dialogs.confirm({
      title: `Merge ${b.name} into ${current}?`,
      description: "Runs git merge --no-edit. Conflicts are reported and left for you to resolve.",
      confirm: "Merge",
    })
    if (!ok) return
    await run("Merge", () => props.app.git.merge(dir(), b.name), `Merged ${b.name} into ${current}`)
  }

  const branchMenu = (b: BranchInfo) =>
    b.remote
      ? [{ label: "Checkout as local branch", icon: "branch" as const, onSelect: () => checkoutBranch(b) }]
      : [
          {
            label: b.current ? "Current branch" : "Checkout",
            icon: "branch" as const,
            disabled: b.current || b.worktree,
            onSelect: () => checkoutBranch(b),
          },
          { label: "Rename", icon: "edit" as const, onSelect: () => void renameBranch(b) },
          { label: "Merge into current", icon: "branch-out" as const, disabled: b.current || b.worktree, onSelect: () => void mergeBranch(b) },
          { type: "separator" as const },
          { label: "Delete", icon: "trash" as const, disabled: b.current, onSelect: () => void deleteBranch(b) },
        ]

  const commitMenu = (c: GraphCommit) => [
    {
      label: "Copy hash",
      icon: "copy" as const,
      onSelect: () => {
        void ctx.system.copy(c.hash)
        ctx.toast.show({ variant: "success", title: "Copied commit hash" })
      },
    },
    {
      label: "New branch here…",
      icon: "plus" as const,
      onSelect: async () => {
        const name = await ctx.dialogs.prompt({ title: "New branch", placeholder: "feature/my-change" })
        if (name === undefined) return
        await run("Create branch", () => props.app.git.create(dir(), name, c.hash), `Created ${name} at ${c.hash.slice(0, 7)}`)
      },
    },
    {
      label: "Show details",
      icon: "eye" as const,
      onSelect: () => showCommit(c),
    },
  ]

  const showCommit = (c: GraphCommit) => {
    ctx.dialogs.open((dialog) => <CommitDialog app={props.app} dir={dir()} commit={c} dialog={dialog} />)
  }

  const refLabel = (ref: string) => (ref.startsWith("HEAD -> ") ? `HEAD → ${ref.slice(8)}` : ref)
  const refClass = (ref: string) =>
    ref.startsWith("HEAD") ? "gg-pill-head" : ref.startsWith("tag:") ? "gg-pill-tag" : "gg-pill-ref"

  return (
    <div class="prr-root gg-root">
      <div class="prr-toolbar">
        <ui.Menu
          trigger="button"
          icon="branch"
          label={ellipsizeMiddle(repo.latest?.branch ?? "…")}
          placement="bottom-start"
          disabled={loading()}
          items={[
            ...locals().map((b) => ({
              label: b.name,
              icon: (b.current ? "check" : "branch") as "check" | "branch",
              onSelect: () => checkoutBranch(b),
            })),
            { type: "separator" as const },
            { label: "New branch…", icon: "plus" as const, onSelect: () => void newBranch() },
          ]}
        />
        <Show when={repo.latest?.nameWithOwner}>{(n) => <span class="prr-muted prr-ellipsis">{n()}</span>}</Show>
        <span class="prr-spacer" />
        <ui.Menu
          icon="menu"
          label="Repository actions"
          placement="bottom-end"
          disabled={busy()}
          items={[
            { label: "Fetch", icon: "download" as const, onSelect: () => void run("Fetch", () => props.app.git.fetch(dir())) },
            { label: "Pull", icon: "download" as const, onSelect: () => void run("Pull", () => props.app.git.pull(dir()), "Up to date") },
            { label: "Push", icon: "cloud-upload" as const, onSelect: () => void run("Push", () => props.app.git.push(dir())) },
          ]}
        />
        <ui.Tooltip value="Refresh">
          <ui.IconButton icon="refresh" label="Refresh" variant="ghost" size="small" busy={loading()} onClick={refresh} />
        </ui.Tooltip>
        <ui.Tooltip value="New branch">
          <ui.IconButton icon="plus" label="New branch" variant="ghost" size="small" disabled={busy()} onClick={() => void newBranch()} />
        </ui.Tooltip>
      </div>

      <Show when={!failure()}>
        <div class="prr-search">
          <ui.TextInput
            label="Search branches and commits"
            placeholder="Search branches, commits, authors"
            type="search"
            value={query()}
            onInput={setQuery}
          />
        </div>
      </Show>

      <div class="prr-scroll">
        <Show when={failure()}>
          {(error) => <ErrorState ctx={ctx} error={error()} directory={dir()} onRetry={refresh} retrying={loading()} />}
        </Show>

        <Show when={!failure()}>
          <section class="gg-section">
            <div class="gg-section-title">
              Branches
              <span class="prr-count">{filteredBranches().length}</span>
              <span class="prr-spacer" />
              <Show when={remotes().length > 0}>
                <button type="button" class="gg-link" onClick={() => setShowRemotes((v) => !v)}>
                  {showRemotes() ? "Hide remotes" : `Remotes (${remotes().length})`}
                </button>
              </Show>
            </div>
            <Show when={branches.latest === undefined && !branches.error}>
              <div class="prr-empty"><ui.Loader /></div>
            </Show>
            <For each={filteredBranches()}>
              {(b) => (
                <div class="gg-branch" classList={{ "gg-branch-current": b.current }} title={b.subject}>
                  <ui.Icon name={b.remote ? "globe" : "branch"} size="small" />
                  <span class="gg-branch-name prr-mono prr-ellipsis">{b.name}</span>
                  <Show when={b.current}>
                    <span class="prr-pill gg-pill-current">current</span>
                  </Show>
                  <Show when={b.worktree}>
                    <span class="prr-pill gg-pill-muted" title="Checked out in another worktree">worktree</span>
                  </Show>
                  <Show when={b.upstream || b.remote}>
                    <span class="gg-track prr-muted">
                      <Show when={b.ahead > 0}>
                        <span class="gg-ahead">
                          <ui.Icon name="arrow-up" size="small" />
                          {b.ahead}
                        </span>
                      </Show>
                      <Show when={b.behind > 0}>
                        <span class="gg-behind">
                          <ui.Icon name="arrow-down-to-line" size="small" />
                          {b.behind}
                        </span>
                      </Show>
                    </span>
                  </Show>
                  <span class="prr-spacer" />
                  <span class="prr-muted prr-ellipsis gg-branch-subject">{b.subject}</span>
                  <ui.Menu icon="menu" label={`Actions for ${b.name}`} placement="bottom-end" items={branchMenu(b)} />
                </div>
              )}
            </For>
            <Show when={branches.latest && filteredBranches().length === 0}>
              <div class="prr-empty prr-muted">
                {query() ? "No branches match your search." : "No branches yet."}
              </div>
            </Show>
          </section>

          <section class="gg-section">
            <div class="gg-section-title">
              History
              <span class="prr-count">{filteredCommits().length}</span>
              <span class="prr-spacer" />
              <span class="gg-tabs">
                <For each={SCOPES}>
                  {(s) => (
                    <button
                      type="button"
                      class="gg-tab"
                      classList={{ "gg-tab-active": scope() === s.value }}
                      onClick={() => setScope(s.value)}
                    >
                      {s.label}
                    </button>
                  )}
                </For>
              </span>
            </div>
            <Show when={graph.error}>
              {(error) => <ErrorState ctx={ctx} error={error()} directory={dir()} onRetry={refresh} retrying={graph.loading} />}
            </Show>
            <Show when={!graph.error && graph.latest === undefined}>
              <div class="prr-empty"><ui.Loader /></div>
            </Show>
            <Show when={graph.latest && layout().rows.length === 0}>
              <div class="prr-empty prr-muted">No commits{query() ? " match your search" : ""}.</div>
            </Show>
            <Show when={graph.latest && layout().rows.length > 0}>
              <div class="gg-graph">
                <svg class="gg-svg" width={layout().width} height={layout().height}>
                  <For each={layout().verticals}>
                    {(v) => (
                      <line
                        x1={layout().x(v.lane)}
                        y1={layout().y(v.fromRow)}
                        x2={layout().x(v.lane)}
                        y2={layout().y(v.toRow)}
                        stroke={laneColor(v.lane)}
                        class="gg-line"
                      />
                    )}
                  </For>
                  <For each={layout().edges}>
                    {(e) => <path d={edgePath(layout(), e)} stroke={laneColor(e.fromLane)} fill="none" class="gg-line" />}
                  </For>
                  <For each={layout().rows}>
                    {(r) => (
                      <circle
                        cx={layout().x(r.lane)}
                        cy={layout().y(r.index)}
                        r={r.commit.head ? 4.5 : 3.5}
                        fill={laneColor(r.lane)}
                        class={r.commit.head ? "gg-dot gg-dot-head" : "gg-dot"}
                      />
                    )}
                  </For>
                </svg>
                <div class="gg-rows">
                  <For each={layout().rows}>
                    {(r) => (
                      <div class="gg-row" style={{ height: `${ROW_H}px` }}>
                        <span class="gg-row-main prr-ellipsis" title={r.commit.subject}>
                          {r.commit.subject}
                        </span>
                        <For each={r.commit.refs}>
                          {(ref) => <span class={`prr-pill ${refClass(ref)}`}>{refLabel(ref)}</span>}
                        </For>
                        <span class="prr-spacer" />
                        <span class="prr-muted gg-row-meta prr-ellipsis">
                          {r.commit.author} · {agoUnix(r.commit.time)} ·{" "}
                          <span class="prr-mono">{r.commit.hash.slice(0, 7)}</span>
                        </span>
                        <ui.Menu icon="menu" label={`Actions for ${r.commit.hash.slice(0, 7)}`} placement="bottom-end" items={commitMenu(r.commit)} />
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </section>
        </Show>
      </div>
    </div>
  )
}

function CommitDialog(props: { app: App; dir: string; commit: GraphCommit; dialog: DialogHandle }) {
  const ui = props.app.ctx.ui
  const [text, setText] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  void props.app.git.show(props.dir, props.commit.hash).then(setText, (e) => setError(errorMessage(e)))
  return (
    <ui.Dialog
      title={props.commit.subject}
      description={`${props.commit.hash} — ${props.commit.author}`}
      size="large"
      footer={<ui.Button onClick={props.dialog.close}>Close</ui.Button>}
    >
      <Show when={error()}>{(e) => <div class="prr-error">{e()}</div>}</Show>
      <Show when={!error() && text() === undefined}>
        <ui.Loader />
      </Show>
      <Show when={text()}>{(t) => <pre class="gg-pre prr-mono">{t()}</pre>}</Show>
    </ui.Dialog>
  )
}
