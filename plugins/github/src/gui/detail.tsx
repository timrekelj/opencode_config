import { createLatest, type IconName, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import type { Check, MergeMethod, PrDetail, Reviewer, TimelineItem } from "../types"
import { prKey, type App } from "./app"
import { CodeTab } from "./code"
import { ErrorState, showErrorToast, StaleBanner } from "./errors"
import { Segmented } from "./list"
import { ago, avatar, checkIcon, checkLabel, plural, stateClass, stateIcon, stateLabel } from "./util"

type Tab = "overview" | "activity" | "files"

const MERGE_METHODS: { value: MergeMethod; label: string; verb: string }[] = [
  { value: "squash", label: "Squash and merge", verb: "Squash and merge" },
  { value: "merge", label: "Create a merge commit", verb: "Merge" },
  { value: "rebase", label: "Rebase and merge", verb: "Rebase and merge" },
]

export function DetailView(props: { app: App; session: MountedSession; screen: SessionScreen; number: number }) {
  const app = props.app
  const ctx = app.ctx
  const ui = ctx.ui
  const [tab, setTab] = createSignal<Tab>("overview")
  const [version, setVersion] = createSignal(0)
  const [busy, setBusy] = createSignal<string>()

  const dir = () => props.session.directory
  const detail = createLatest(
    () => `${dir()}\n${props.number}\n${version()}`,
    async (key, signal) => {
      const [d, n] = key.split("\n")
      const result = await app.api.detail(d, Number(n), signal)
      app.setTitle(prKey(d, result.number), result.title)
      return result
    },
  )

  const refresh = () => setVersion((v) => v + 1)

  const run = async (label: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(label)
    try {
      await fn()
      if (success) ctx.toast.show({ variant: "success", title: success })
      refresh()
      return true
    } catch (error) {
      showErrorToast(ctx, label, error, dir())
      return false
    } finally {
      setBusy(undefined)
    }
  }

  const reviewWithAgent = (pr: PrDetail) =>
    ctx.layout.draft({ server: props.session.server.id, directory: dir(), prompt: `/review ${pr.number}` })

  const attachToChat = (pr: PrDetail) => {
    const composer = props.screen.composer
    composer.attach({
      type: "note",
      origin: ctx.id,
      commentID: crypto.randomUUID(),
      label: `PR #${pr.number}`,
      icon: "github",
      subject: `GitHub pull request #${pr.number} "${pr.title}" (${pr.url}), ${pr.head} → ${pr.base}. Read it with \`gh pr view ${pr.number}\` and \`gh pr diff ${pr.number}\`.`,
      comment: "",
      href: pr.url,
    })
    composer.focus()
  }

  const checkout = async (pr: PrDetail) => {
    const ok = await ctx.dialogs.confirm({
      title: `Check out #${pr.number}?`,
      description: `Switches ${dir()} to ${pr.head}. Uncommitted changes can block the checkout.`,
      confirm: "Check out",
    })
    if (!ok) return
    if (await run("Checkout", () => app.api.checkout(dir(), pr.number), `Checked out ${pr.head}`)) app.bumpBranch()
  }

  const merge = async (pr: PrDetail, method: MergeMethod) => {
    const verb = MERGE_METHODS.find((m) => m.value === method)!.verb
    const ok = await ctx.dialogs.confirm({
      title: `${verb} #${pr.number}?`,
      description: `Merges "${pr.title}" into ${pr.base} on GitHub.`,
      confirm: verb,
    })
    if (!ok) return
    if (await run("Merge", () => app.api.merge(dir(), pr.number, method), `Merged #${pr.number}`)) app.bumpBranch()
  }

  const ready = (pr: PrDetail) =>
    void run("Mark ready", () => app.api.ready(dir(), pr.number), `#${pr.number} is ready for review`)

  return (
    <div class="prr-root">
      <Show when={detail.error && !detail.latest}>
        <ErrorState ctx={ctx} error={detail.error} directory={dir()} onRetry={refresh} retrying={detail.loading} />
      </Show>
      <Show when={!detail.latest && !detail.error}>
        <div class="prr-empty">
          <ui.Loader />
        </div>
      </Show>
      <Show when={detail.latest}>
        {(pr) => {
          const open = () => pr().state === "OPEN"
          const comments = () => pr().timeline.filter((t) => t.kind !== "commit").length
          return (
            <>
              <header class="prr-header">
                <div class="prr-header-row">
                  <h2 class="prr-title">
                    {pr().title} <span class="prr-title-number">#{pr().number}</span>
                  </h2>
                  <ui.Tooltip value="Refresh">
                    <ui.IconButton
                      icon="refresh"
                      label="Refresh"
                      variant="ghost"
                      size="small"
                      busy={detail.loading}
                      onClick={refresh}
                    />
                  </ui.Tooltip>
                  <ui.Tooltip value="Open on GitHub">
                    <ui.IconButton
                      icon="square-arrow-top-right"
                      label="Open on GitHub"
                      variant="ghost"
                      size="small"
                      onClick={() => ctx.system.openExternal(pr().url)}
                    />
                  </ui.Tooltip>
                  <ui.Menu
                    label="More actions"
                    placement="bottom-end"
                    items={[
                      { label: "Attach to chat", icon: "prompt", onSelect: () => attachToChat(pr()) },
                      { label: "Check out branch", icon: "branch", onSelect: () => void checkout(pr()) },
                      {
                        label: "Copy link",
                        icon: "copy",
                        onSelect: () => {
                          void ctx.system.copy(pr().url)
                          ctx.toast.show({ variant: "success", title: "Link copied" })
                        },
                      },
                      {
                        label: "Copy branch name",
                        icon: "copy",
                        onSelect: () => {
                          void ctx.system.copy(pr().head)
                          ctx.toast.show({ variant: "success", title: "Branch name copied" })
                        },
                      },
                    ]}
                  />
                </div>

                <div class="prr-header-meta">
                  <span class={`prr-badge prr-badge-${stateClass(pr())}`}>
                    <ui.Icon name={stateIcon(pr())} size="small" />
                    {stateLabel(pr())}
                  </span>
                  <span class="prr-strong">{pr().author}</span>
                  <span class="prr-muted">
                    {pr().state === "MERGED" ? " merged " : pr().state === "CLOSED" ? " proposed merging " : " wants to merge "}
                  </span>
                  <span class="prr-mono-inline prr-ref" title={pr().head}>
                    {pr().head}
                  </span>
                  <span class="prr-muted"> into </span>
                  <span class="prr-mono-inline prr-ref">{pr().base}</span>
                  <span class="prr-sep">·</span>
                  <span class="prr-diffstat" title={`${plural(pr().changedFiles, "file")} changed`}>
                    <span class="prr-add">+{pr().additions}</span>
                    <span class="prr-del">−{pr().deletions}</span>
                  </span>
                </div>

                <div class="prr-actions">
                  <ui.Button size="small" variant="contrast" icon="review" onClick={() => reviewWithAgent(pr())}>
                    Review with agent
                  </ui.Button>
                  <ui.Button size="small" icon="branch" busy={busy() === "Checkout"} onClick={() => void checkout(pr())}>
                    Check out
                  </ui.Button>
                  <Show when={open() && pr().draft}>
                    <ui.Button size="small" icon="check" busy={busy() === "Mark ready"} onClick={() => ready(pr())}>
                      Ready for review
                    </ui.Button>
                  </Show>
                  <Show when={open() && !pr().draft}>
                    <ui.Menu
                      trigger="button"
                      label={busy() === "Merge" ? "Merging…" : "Merge"}
                      icon="branch-out"
                      placement="bottom-start"
                      disabled={!!busy() || pr().mergeable === "CONFLICTING"}
                      items={MERGE_METHODS.map((m) => ({ label: m.label, onSelect: () => void merge(pr(), m.value) }))}
                    />
                  </Show>
                </div>

                <nav class="prr-tabs" role="tablist">
                  <TabButton current={tab()} id="overview" onSelect={setTab}>
                    Overview
                  </TabButton>
                  <TabButton current={tab()} id="activity" onSelect={setTab} count={comments()}>
                    Activity
                  </TabButton>
                  <TabButton current={tab()} id="files" onSelect={setTab} count={pr().changedFiles}>
                    Files
                  </TabButton>
                  <span class="prr-spacer" />
                  <Show when={pr().checks !== "none"}>
                    <button
                      type="button"
                      class={`prr-tabs-checks prr-tone-${pr().checks}`}
                      title={checkLabel(pr().checks)}
                      onClick={() => setTab("overview")}
                    >
                      <ui.Icon name={checkIcon(pr().checks)} size="small" />
                      <span class="prr-tabs-checks-label">{checkLabel(pr().checks)}</span>
                    </button>
                  </Show>
                </nav>
              </header>

              <Show when={detail.error}>
                <StaleBanner ctx={ctx} error={detail.error} directory={dir()} onRetry={refresh} />
              </Show>

              <Switch>
                <Match when={tab() === "overview"}>
                  <OverviewTab app={app} pr={pr()} />
                </Match>
                <Match when={tab() === "activity"}>
                  <ActivityTab
                    app={app}
                    pr={pr()}
                    onComment={(body) => run("Comment", () => app.api.comment(dir(), pr().number, body), "Comment posted")}
                  />
                </Match>
                <Match when={tab() === "files"}>
                  <CodeTab
                    app={app}
                    session={props.session}
                    screen={props.screen}
                    pr={pr()}
                    version={version()}
                    onSubmitted={refresh}
                  />
                </Match>
              </Switch>
            </>
          )
        }}
      </Show>
    </div>
  )
}

function TabButton(props: { current: Tab; id: Tab; count?: number; onSelect: (tab: Tab) => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.current === props.id}
      class="prr-tab"
      classList={{ "prr-tab-active": props.current === props.id }}
      onClick={() => props.onSelect(props.id)}
    >
      {props.children}
      <Show when={props.count}>
        <span class="prr-count">{props.count}</span>
      </Show>
    </button>
  )
}

// --- overview --------------------------------------------------------------------------------------------------------

const REVIEWER: Record<Reviewer["state"], { label: string; tone: string; icon: IconName }> = {
  APPROVED: { label: "Approved", tone: "success", icon: "circle-check" },
  CHANGES_REQUESTED: { label: "Requested changes", tone: "failure", icon: "circle-x" },
  COMMENTED: { label: "Commented", tone: "neutral", icon: "comment" },
  DISMISSED: { label: "Dismissed", tone: "neutral", icon: "circle-ban-sign" },
  PENDING: { label: "Pending", tone: "pending", icon: "status-active" },
  REQUESTED: { label: "Awaiting review", tone: "pending", icon: "status-active" },
}

interface Status {
  tone: "success" | "failure" | "pending" | "neutral"
  icon: IconName
  title: string
  detail?: string
}

function reviewStatus(pr: PrDetail): Status {
  if (pr.reviewDecision === "APPROVED") return { tone: "success", icon: "circle-check", title: "Approved" }
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    return { tone: "failure", icon: "circle-x", title: "Changes requested" }
  if (pr.reviewDecision === "REVIEW_REQUIRED")
    return { tone: "pending", icon: "status-active", title: "Review required", detail: "At least one approval is needed." }
  return {
    tone: "neutral",
    icon: "comment",
    title: pr.reviewers.length ? "Reviews" : "No reviews",
    detail: pr.reviewers.length || pr.state !== "OPEN" ? undefined : "No one has been asked to review.",
  }
}

function checksStatus(pr: PrDetail): Status {
  const count = (state: Check["state"]) => pr.checkList.filter((c) => c.state === state).length
  const parts = [
    count("failure") && `${count("failure")} failing`,
    count("pending") && `${count("pending")} running`,
    count("success") && `${count("success")} passed`,
    count("skipped") + count("neutral") && `${count("skipped") + count("neutral")} skipped`,
  ].filter(Boolean)
  const tone = pr.checks === "none" || pr.checks === "skipped" ? "neutral" : pr.checks
  return { tone, icon: checkIcon(pr.checks), title: checkLabel(pr.checks), detail: parts.join(", ") || undefined }
}

function mergeStatus(pr: PrDetail): Status {
  if (pr.state === "MERGED") return { tone: "neutral", icon: "branch-out", title: `Merged into ${pr.base}` }
  if (pr.state === "CLOSED") return { tone: "neutral", icon: "circle-x", title: "Closed without merging" }
  if (pr.mergeable === "CONFLICTING")
    return { tone: "failure", icon: "circle-x", title: "Conflicts", detail: `Resolve the conflicts with ${pr.base} first.` }
  if (pr.draft)
    return { tone: "neutral", icon: "circle-ban-sign", title: "Draft", detail: "Mark it ready for review to merge." }
  switch (pr.mergeStateStatus) {
    case "CLEAN":
      return { tone: "success", icon: "circle-check", title: "Ready to merge", detail: `No conflicts with ${pr.base}.` }
    case "BEHIND":
      return { tone: "pending", icon: "status-active", title: `Behind ${pr.base}`, detail: "Update the branch before merging." }
    case "BLOCKED":
      return { tone: "pending", icon: "lock", title: "Blocked", detail: "Branch protection rules block merging." }
    case "UNSTABLE":
      return { tone: "pending", icon: "warning", title: "Mergeable", detail: "Some checks failed, but merging is allowed." }
    case "DRAFT":
      return { tone: "neutral", icon: "circle-ban-sign", title: "Draft", detail: "Mark it ready for review to merge." }
    case "HAS_HOOKS":
      return { tone: "success", icon: "circle-check", title: "Ready to merge" }
  }
  return { tone: "neutral", icon: "status", title: "Checking mergeability…" }
}

function OverviewTab(props: { app: App; pr: PrDetail }) {
  const ctx = props.app.ctx
  const ui = ctx.ui
  const pr = () => props.pr
  const [showChecks, setShowChecks] = createSignal(props.pr.checks === "failure")

  return (
    <div class="prr-scroll prr-pad">
      <article class="prr-card">
        <header class="prr-card-head">
          <Avatar login={pr().author} />
          <span class="prr-strong">{pr().author}</span>
          <span class="prr-muted">opened {ago(pr().createdAt)}</span>
          <span class="prr-spacer" />
          <span class="prr-muted">updated {ago(pr().updatedAt)}</span>
        </header>
        <div class="prr-card-body">
          <Show when={pr().body.trim()} fallback={<p class="prr-muted prr-italic">No description provided.</p>}>
            <ui.Markdown text={pr().body} class="prr-markdown" />
          </Show>
        </div>
        <Show when={pr().labels.length > 0}>
          <footer class="prr-card-foot">
            <For each={pr().labels}>
              {(label) => (
                <span class="prr-label" style={{ "--prr-label": `#${label.color}` }}>
                  {label.name}
                </span>
              )}
            </For>
          </footer>
        </Show>
      </article>

      <section class="prr-box" aria-label="Merge status">
        <StatusRow app={props.app} status={reviewStatus(pr())}>
          <Show when={pr().reviewers.length > 0}>
            <ul class="prr-sublist">
              <For each={pr().reviewers}>
                {(reviewer) => (
                  <li class="prr-subitem">
                    <Avatar login={reviewer.login} />
                    <span class="prr-ellipsis">{reviewer.login}</span>
                    <span class="prr-spacer" />
                    <span class={`prr-inline prr-tone-${REVIEWER[reviewer.state].tone}`}>
                      <ui.Icon name={REVIEWER[reviewer.state].icon} size="small" />
                      <span class="prr-muted">{REVIEWER[reviewer.state].label}</span>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </StatusRow>

        <StatusRow
          app={props.app}
          status={checksStatus(pr())}
          action={
            pr().checkList.length > 0 ? (
              <button type="button" class="prr-link" onClick={() => setShowChecks((v) => !v)}>
                {showChecks() ? "Hide" : `Show ${pr().checkList.length}`}
              </button>
            ) : undefined
          }
        >
          <Show when={showChecks() && pr().checkList.length > 0}>
            <ul class="prr-sublist">
              <For each={pr().checkList}>
                {(check) => (
                  <li>
                    <button
                      type="button"
                      class="prr-subitem prr-subitem-button"
                      disabled={!check.url}
                      title={check.url ? "Open details" : undefined}
                      onClick={() => check.url && ctx.system.openExternal(check.url)}
                    >
                      <span class={`prr-inline prr-tone-${check.state}`}>
                        <ui.Icon name={checkIcon(check.state)} size="small" />
                      </span>
                      <span class="prr-ellipsis">
                        <Show when={check.workflow}>
                          <span class="prr-muted">{check.workflow} / </span>
                        </Show>
                        {check.name}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </StatusRow>

        <StatusRow app={props.app} status={mergeStatus(pr())} />
      </section>
    </div>
  )
}

function StatusRow(props: { app: App; status: Status; action?: JSX.Element; children?: JSX.Element }) {
  const ui = props.app.ctx.ui
  return (
    <div class="prr-status">
      <div class="prr-status-head">
        <span class={`prr-status-icon prr-tone-${props.status.tone}`}>
          <ui.Icon name={props.status.icon} size="normal" />
        </span>
        <span class="prr-status-text">
          <span class="prr-strong">{props.status.title}</span>
          <Show when={props.status.detail}>
            <span class="prr-muted">{props.status.detail}</span>
          </Show>
        </span>
        <span class="prr-spacer" />
        {props.action}
      </div>
      {props.children}
    </div>
  )
}

function Avatar(props: { login: string }) {
  return (
    <img
      class="prr-avatar"
      src={avatar(props.login)}
      alt=""
      loading="lazy"
      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
    />
  )
}

// --- activity --------------------------------------------------------------------------------------------------------

const REVIEW_VERB: Record<string, string> = {
  APPROVED: "approved these changes",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "had a review dismissed",
}

type CommitItem = Extract<TimelineItem, { kind: "commit" }>
type Entry = Exclude<TimelineItem, { kind: "commit" }>
type Block = { kind: "commits"; id: string; commits: CommitItem[] } | { kind: "entry"; id: string; entry: Entry }

function ActivityTab(props: { app: App; pr: PrDetail; onComment: (body: string) => Promise<boolean> }) {
  const ui = props.app.ctx.ui
  const [body, setBody] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [filter, setFilter] = createSignal<"all" | "conversation">("all")

  // Consecutive commits collapse into one block, as GitHub's timeline shows them.
  const blocks = createMemo(() => {
    const out: Block[] = []
    for (const item of props.pr.timeline) {
      if (item.kind === "commit") {
        if (filter() === "conversation") continue
        const last = out[out.length - 1]
        if (last?.kind === "commits") last.commits.push(item)
        else out.push({ kind: "commits", id: item.id, commits: [item] })
      } else out.push({ kind: "entry", id: item.id, entry: item })
    }
    return out
  })

  const send = async () => {
    if (!body().trim() || sending()) return
    setSending(true)
    const ok = await props.onComment(body())
    setSending(false)
    if (ok) setBody("")
  }

  return (
    <div class="prr-scroll prr-pad">
      <div class="prr-activity-bar">
        <Segmented
          label="Activity filter"
          value={filter()}
          onChange={setFilter}
          options={[
            { value: "all", label: "Everything" },
            { value: "conversation", label: "Comments only" },
          ]}
        />
      </div>
      <Show when={blocks().length === 0}>
        <div class="prr-empty prr-muted">No activity yet.</div>
      </Show>
      <ol class="prr-timeline">
        <For each={blocks()}>
          {(block) => (
            <Switch>
              <Match when={block.kind === "commits" && block}>
                {(b) => (
                  <li class="prr-tl-item prr-tl-commits">
                    <span class="prr-tl-dot">
                      <ui.Icon name="code-lines" size="small" />
                    </span>
                    <div class="prr-tl-main">
                      <div class="prr-tl-head prr-muted">
                        {plural(b().commits.length, "commit")} by {[...new Set(b().commits.map((c) => c.author))].join(", ")}
                      </div>
                      <ul class="prr-commits">
                        <For each={b().commits}>
                          {(commit) => (
                            <li class="prr-commit">
                              <span class="prr-ellipsis">{commit.message}</span>
                              <span class="prr-spacer" />
                              <span class="prr-muted prr-commit-time">{ago(commit.createdAt)}</span>
                              <code class="prr-mono-inline prr-muted">{commit.id.slice(0, 7)}</code>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  </li>
                )}
              </Match>
              <Match when={block.kind === "entry" && block}>
                {(b) => {
                  const entry = () => b().entry
                  const state = () => (entry().kind === "review" ? (entry() as { state: string }).state : "")
                  return (
                    <li class="prr-tl-item">
                      <span class="prr-tl-dot prr-tl-avatar">
                        <Avatar login={entry().author} />
                      </span>
                      <div class="prr-tl-main">
                        <div class="prr-tl-head">
                          <span class="prr-strong">{entry().author}</span>
                          <span
                            class="prr-muted"
                            classList={{
                              "prr-tone-success": state() === "APPROVED",
                              "prr-tone-failure": state() === "CHANGES_REQUESTED",
                            }}
                          >
                            {entry().kind === "review" ? (REVIEW_VERB[state()] ?? "reviewed") : "commented"}
                          </span>
                          <span class="prr-spacer" />
                          <span class="prr-muted">{ago(entry().createdAt)}</span>
                        </div>
                        <Show when={entry().body.trim()}>
                          <div class="prr-card prr-card-body">
                            <ui.Markdown text={entry().body} class="prr-markdown" />
                          </div>
                        </Show>
                      </div>
                    </li>
                  )
                }}
              </Match>
            </Switch>
          )}
        </For>
      </ol>

      <div class="prr-compose">
        <textarea
          class="prr-textarea"
          placeholder="Leave a comment"
          value={body()}
          onInput={(e) => setBody(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send()
          }}
        />
        <div class="prr-compose-actions">
          <span class="prr-hint prr-muted">Markdown supported · ⌘↵ to send</span>
          <span class="prr-spacer" />
          <ui.Button size="small" variant="contrast" onClick={() => void send()} busy={sending()} disabled={!body().trim()}>
            Comment
          </ui.Button>
        </div>
      </div>
    </div>
  )
}
