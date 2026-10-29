import { createLatest, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import type { MergeMethod, PrDetail, Reviewer, TimelineItem } from "../types"
import { prKey, type App } from "./app"
import { CodeTab } from "./code"
import { ErrorState, showErrorToast, StaleBanner } from "./errors"
import { ago, avatar, checkIcon, checkLabel, stateClass, stateLabel } from "./util"

type Tab = "summary" | "timeline" | "code"

export function DetailView(props: { app: App; session: MountedSession; screen: SessionScreen; number: number }) {
  const app = props.app
  const ctx = app.ctx
  const ui = ctx.ui
  const [tab, setTab] = createSignal<Tab>("summary")
  const [version, setVersion] = createSignal(0)
  const [busy, setBusy] = createSignal<string>()

  const dir = () => props.session.directory
  const detail = createLatest(
    () => `${dir()}\n${props.number}\n${version()}`,
    async (key) => {
      const [d, n] = key.split("\n")
      const result = await app.api.detail(d, Number(n))
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

  const reviewWithAgent = (pr: PrDetail) => {
    ctx.layout.draft({
      server: props.session.server.id,
      directory: dir(),
      prompt: `/review ${pr.number}`,
    })
  }

  const attachToChat = (pr: PrDetail) => {
    const composer = ctx.screen.current()?.composer
    if (!composer) return
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
      description: `Switches ${dir()} to branch ${pr.head}. Uncommitted changes may block the checkout.`,
      confirm: "Check out",
    })
    if (ok) void run("Checkout", () => app.api.checkout(dir(), pr.number), `Checked out ${pr.head}`)
  }

  const merge = async (pr: PrDetail, method: MergeMethod) => {
    const verb = { squash: "Squash and merge", merge: "Create a merge commit", rebase: "Rebase and merge" }[method]
    const ok = await ctx.dialogs.confirm({
      title: `${verb}?`,
      description: `Merges #${pr.number} "${pr.title}" into ${pr.base}.`,
      confirm: verb,
    })
    if (ok) void run("Merge", () => app.api.merge(dir(), pr.number, method), `Merged #${pr.number}`)
  }

  return (
    <div class="prr-root">
      <Show when={detail.error && !detail.latest}>
        <ErrorState ctx={ctx} error={detail.error} directory={dir()} onRetry={refresh} retrying={detail.loading} />
      </Show>
      <Show when={detail.error && detail.latest}>
        <StaleBanner ctx={ctx} error={detail.error} directory={dir()} onRetry={refresh} />
      </Show>
      <Show when={!detail.latest && !detail.error}>
        <div class="prr-empty">
          <ui.Loader />
        </div>
      </Show>
      <Show when={detail.latest}>
        {(pr) => (
          <>
            <header class="prr-header">
              <div class="prr-header-top">
                <span class={`prr-pill prr-state-${stateClass(pr())}`}>{stateLabel(pr())}</span>
                <span class="prr-muted prr-number">#{pr().number}</span>
                <span class="prr-spacer" />
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
                  trigger="icon"
                  icon="outline-dots"
                  placement="bottom-end"
                  items={[
                    { label: "Attach to chat", icon: "prompt", onSelect: () => attachToChat(pr()) },
                    { label: "Check out branch", icon: "branch", onSelect: () => void checkout(pr()) },
                    { label: "Copy link", icon: "copy", onSelect: () => void ctx.system.copy(pr().url) },
                    { type: "separator" },
                    ...(pr().state === "OPEN" && pr().draft
                      ? [
                          {
                            label: "Mark ready for review",
                            icon: "check" as const,
                            onSelect: () =>
                              void run("Mark ready", () => app.api.ready(dir(), pr().number), "Marked ready for review"),
                          },
                        ]
                      : []),
                    {
                      type: "group",
                      label: "Merge",
                      items: (["squash", "merge", "rebase"] as const).map((method) => ({
                        label: { squash: "Squash and merge", merge: "Merge commit", rebase: "Rebase and merge" }[method],
                        icon: "fork" as const,
                        disabled: pr().state !== "OPEN" || pr().draft,
                        onSelect: () => void merge(pr(), method),
                      })),
                    },
                  ]}
                />
              </div>
              <h2 class="prr-title">{pr().title}</h2>
              <div class="prr-muted prr-subtitle">
                <span class="prr-strong-muted">{pr().author}</span>
                <span> wants to merge </span>
                <span class="prr-branch">{pr().head}</span>
                <span> into </span>
                <span class="prr-branch">{pr().base}</span>
              </div>
              <div class="prr-header-actions">
                <ui.Button
                  size="small"
                  variant="contrast"
                  icon="review"
                  onClick={() => reviewWithAgent(pr())}
                  disabled={!!busy()}
                >
                  Review with agent
                </ui.Button>
                <ui.Button size="small" icon="branch" onClick={() => void checkout(pr())} busy={busy() === "Checkout"}>
                  Check out
                </ui.Button>
                <Show when={pr().state === "OPEN" && !pr().draft}>
                  <ui.Button
                    size="small"
                    icon="fork"
                    onClick={() => void merge(pr(), "squash")}
                    busy={busy() === "Merge"}
                    disabled={pr().mergeable === "CONFLICTING"}
                  >
                    Merge
                  </ui.Button>
                </Show>
              </div>
              <nav class="prr-tabs">
                <TabButton current={tab()} id="summary" onSelect={setTab}>
                  Summary
                </TabButton>
                <TabButton current={tab()} id="timeline" onSelect={setTab}>
                  Timeline
                  <span class="prr-count">{pr().timeline.filter((t) => t.kind !== "commit").length}</span>
                </TabButton>
                <TabButton current={tab()} id="code" onSelect={setTab}>
                  Code
                  <span class="prr-count">{pr().changedFiles}</span>
                </TabButton>
                <span class="prr-spacer" />
                <span class={`prr-tabs-checks prr-tone-${pr().checks}`} title={checkLabel(pr().checks)}>
                  <ui.Icon name={checkIcon(pr().checks)} size="small" />
                  <span class="prr-tabs-checks-label">{checkLabel(pr().checks)}</span>
                </span>
              </nav>
            </header>

            <Switch>
              <Match when={tab() === "summary"}>
                <SummaryTab app={app} pr={pr()} />
              </Match>
              <Match when={tab() === "timeline"}>
                <TimelineTab
                  app={app}
                  pr={pr()}
                  onComment={(body) => run("Comment", () => app.api.comment(dir(), pr().number, body), "Comment posted")}
                />
              </Match>
              <Match when={tab() === "code"}>
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
        )}
      </Show>
    </div>
  )
}

function TabButton(props: { current: Tab; id: Tab; onSelect: (tab: Tab) => void; children: any }) {
  return (
    <button
      type="button"
      class="prr-tab"
      classList={{ "prr-tab-active": props.current === props.id }}
      onClick={() => props.onSelect(props.id)}
    >
      {props.children}
    </button>
  )
}

const REVIEWER_STATE: Record<Reviewer["state"], { label: string; tone: string; icon: any }> = {
  APPROVED: { label: "Approved", tone: "success", icon: "circle-check" },
  CHANGES_REQUESTED: { label: "Requested changes", tone: "failure", icon: "circle-x" },
  COMMENTED: { label: "Commented", tone: "neutral", icon: "comment" },
  DISMISSED: { label: "Dismissed", tone: "neutral", icon: "circle-ban-sign" },
  PENDING: { label: "Pending", tone: "pending", icon: "status-active" },
  REQUESTED: { label: "Awaiting review", tone: "pending", icon: "status-active" },
}

function mergeStatus(pr: PrDetail): { tone: string; text: string } | undefined {
  if (pr.state !== "OPEN") return undefined
  if (pr.mergeable === "CONFLICTING") return { tone: "failure", text: "This branch has conflicts that must be resolved." }
  switch (pr.mergeStateStatus) {
    case "BEHIND":
      return { tone: "pending", text: `This branch is behind ${pr.base}.` }
    case "BLOCKED":
      return { tone: "pending", text: "Merging is blocked by branch protection rules." }
    case "UNSTABLE":
      return { tone: "pending", text: "Some checks are failing, but the branch can be merged." }
    case "CLEAN":
      return { tone: "success", text: "No conflicts with the base branch." }
    case "DRAFT":
      return { tone: "neutral", text: "This pull request is still a draft." }
  }
  return undefined
}

function SummaryTab(props: { app: App; pr: PrDetail }) {
  const ui = props.app.ctx.ui
  return (
    <div class="prr-scroll prr-pad">
      <div class="prr-stats prr-muted">
        <span class="prr-add">+{props.pr.additions}</span>
        <span class="prr-del">−{props.pr.deletions}</span>
        <span>
          {props.pr.changedFiles} file{props.pr.changedFiles === 1 ? "" : "s"}
        </span>
        <span>·</span>
        <span>opened {ago(props.pr.createdAt)}</span>
        <span>·</span>
        <span>updated {ago(props.pr.updatedAt)}</span>
      </div>

      <Show when={props.pr.labels.length > 0}>
        <div class="prr-labels">
          <For each={props.pr.labels}>
            {(label) => (
              <span class="prr-label" style={{ "--prr-label": `#${label.color}` }}>
                {label.name}
              </span>
            )}
          </For>
        </div>
      </Show>

      <section class="prr-card">
        <Show when={props.pr.body.trim()} fallback={<p class="prr-muted">No description provided.</p>}>
          <ui.Markdown text={props.pr.body} class="prr-markdown" />
        </Show>
      </section>

      <Show when={mergeStatus(props.pr)}>
        {(status) => (
          <div class={`prr-callout prr-tone-${status().tone}`}>
            <ui.Icon name={checkIcon(status().tone as any)} size="small" />
            <span>{status().text}</span>
          </div>
        )}
      </Show>

      <section class="prr-section">
        <div class="prr-section-title">Reviewers</div>
        <Show when={props.pr.reviewers.length > 0} fallback={<div class="prr-muted">No reviewers.</div>}>
          <For each={props.pr.reviewers}>
            {(reviewer) => (
              <div class="prr-item">
                <img class="prr-avatar" src={avatar(reviewer.login)} alt="" onError={(e) => e.currentTarget.remove()} />
                <span class="prr-ellipsis">{reviewer.login}</span>
                <span class="prr-spacer" />
                <span class={`prr-inline prr-tone-${REVIEWER_STATE[reviewer.state].tone}`}>
                  <ui.Icon name={REVIEWER_STATE[reviewer.state].icon} size="small" />
                  <span class="prr-muted">{REVIEWER_STATE[reviewer.state].label}</span>
                </span>
              </div>
            )}
          </For>
        </Show>
      </section>

      <section class="prr-section">
        <div class="prr-section-title">
          Checks
          <span class="prr-count">{props.pr.checkList.length}</span>
        </div>
        <Show when={props.pr.checkList.length > 0} fallback={<div class="prr-muted">No checks reported.</div>}>
          <For each={props.pr.checkList}>
            {(check) => (
              <button
                type="button"
                class="prr-item prr-item-button"
                disabled={!check.url}
                onClick={() => check.url && props.app.ctx.system.openExternal(check.url)}
              >
                <span class={`prr-tone-${check.state}`}>
                  <ui.Icon name={checkIcon(check.state)} size="small" />
                </span>
                <span class="prr-ellipsis">
                  <Show when={check.workflow}>
                    <span class="prr-muted">{check.workflow} / </span>
                  </Show>
                  {check.name}
                </span>
              </button>
            )}
          </For>
        </Show>
      </section>
    </div>
  )
}

const REVIEW_VERB: Record<string, string> = {
  APPROVED: "approved these changes",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "had a review dismissed",
}

function TimelineTab(props: { app: App; pr: PrDetail; onComment: (body: string) => Promise<boolean> }) {
  const ui = props.app.ctx.ui
  const [body, setBody] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const send = async () => {
    if (!body().trim()) return
    setSending(true)
    const ok = await props.onComment(body())
    setSending(false)
    if (ok) setBody("")
  }

  return (
    <div class="prr-scroll prr-pad">
      <Show when={props.pr.timeline.length === 0}>
        <div class="prr-muted">No activity yet.</div>
      </Show>
      <ol class="prr-timeline">
        <For each={props.pr.timeline}>
          {(item: TimelineItem) => (
            <Switch>
              <Match when={item.kind === "commit" && item}>
                {(commit) => (
                  <li class="prr-event prr-event-commit">
                    <ui.Icon name="code-lines" size="small" />
                    <span class="prr-ellipsis">{commit().message}</span>
                    <span class="prr-mono prr-muted">{commit().id.slice(0, 7)}</span>
                  </li>
                )}
              </Match>
              <Match when={item.kind !== "commit" && (item as Exclude<TimelineItem, { kind: "commit" }>)}>
                {(entry) => (
                  <li class="prr-event">
                    <div class="prr-event-head">
                      <img class="prr-avatar" src={avatar(entry().author)} alt="" onError={(e) => e.currentTarget.remove()} />
                      <span class="prr-strong">{entry().author}</span>
                      <span class="prr-muted">
                        {entry().kind === "review"
                          ? (REVIEW_VERB[(entry() as { state: string }).state] ?? "reviewed")
                          : "commented"}
                      </span>
                      <span class="prr-spacer" />
                      <span class="prr-muted">{ago(entry().createdAt)}</span>
                    </div>
                    <Show when={entry().body.trim()}>
                      <div class="prr-card">
                        <ui.Markdown text={entry().body} class="prr-markdown" />
                      </div>
                    </Show>
                  </li>
                )}
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
          <ui.Button size="small" variant="contrast" onClick={() => void send()} busy={sending()} disabled={!body().trim()}>
            Comment
          </ui.Button>
        </div>
      </div>
    </div>
  )
}
