import { createLatest, type MountedSession } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { ListState, PrSummary } from "../types"
import type { App } from "./app"
import { ErrorState, StaleBanner } from "./errors"
import { ago, checkIcon, checkLabel, stateClass, stateIcon, stateLabel } from "./util"

const STATES: { value: ListState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
]

export function ListView(props: { app: App; session: MountedSession }) {
  const ctx = props.app.ctx
  const ui = ctx.ui
  const [query, setQuery] = createSignal("")
  const [state, setState] = createSignal<ListState>("open")
  const [version, setVersion] = createSignal(0)
  const dir = () => props.session.directory

  const repo = createLatest(
    () => `${dir()}\n${version()}`,
    (key) => props.app.api.repo(key.split("\n")[0]),
  )
  // Only list once the repository resolves, so a broken repo shows one error instead of two.
  const prs = createLatest(
    () => (repo.latest && !repo.error ? `${dir()}\n${state()}\n${version()}` : undefined),
    (key) => {
      const [d, s] = key.split("\n")
      return props.app.api.list(d, s as ListState)
    },
  )

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    const list = prs.latest ?? []
    if (!q) return list
    const number = q.replace(/^#/, "")
    return list.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).startsWith(number) ||
        pr.head.toLowerCase().includes(q) ||
        pr.author.toLowerCase().includes(q) ||
        pr.labels.some((l) => l.name.toLowerCase().includes(q)),
    )
  })

  const groups = createMemo(() => {
    const viewer = repo.latest?.viewer
    const review: PrSummary[] = []
    const mine: PrSummary[] = []
    const rest: PrSummary[] = []
    for (const pr of filtered()) {
      if (pr.reviewRequested) review.push(pr)
      else if (viewer && pr.author === viewer) mine.push(pr)
      else rest.push(pr)
    }
    return [
      { id: "review", title: "Needs your review", items: review },
      { id: "mine", title: "Created by you", items: mine },
      { id: "rest", title: review.length || mine.length ? "Others" : "", items: rest },
    ].filter((g) => g.items.length > 0)
  })

  const failure = () => (prs.latest ? undefined : (repo.error ?? prs.error))
  const stale = () => (prs.latest ? prs.error : undefined)
  const loading = () => repo.loading || prs.loading
  const retry = () => setVersion((v) => v + 1)
  const currentNumber = () => props.app.currentPr(dir())?.number

  const open = (pr: PrSummary, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) return ctx.system.openExternal(pr.url)
    props.app.openPr(props.session, pr.number)
  }

  const emptyText = () => {
    if (query()) return "No pull requests match your search."
    if (state() === "all") return "This repository has no pull requests yet."
    return `No ${STATES.find((s) => s.value === state())!.label.toLowerCase()} pull requests.`
  }

  return (
    <div class="prr-root">
      <div class="prr-list-head">
        <div class="prr-list-repo">
          <Show when={repo.latest} fallback={<span class="prr-muted">Pull requests</span>}>
            {(r) => (
              <button
                type="button"
                class="prr-link-quiet prr-ellipsis"
                title="Open pull requests on GitHub"
                onClick={() => ctx.system.openExternal(`${r().url}/pulls`)}
              >
                {r().nameWithOwner}
              </button>
            )}
          </Show>
          <span class="prr-spacer" />
          <ui.Tooltip value="Refresh">
            <ui.IconButton icon="refresh" label="Refresh" variant="ghost" size="small" busy={loading()} onClick={retry} />
          </ui.Tooltip>
        </div>
        <Show when={!failure()}>
          <div class="prr-list-controls">
            <div class="prr-grow">
              <ui.TextInput
                label="Search pull requests"
                placeholder="Search title, #number, branch, author"
                type="search"
                value={query()}
                onInput={setQuery}
              />
            </div>
            <Segmented value={state()} options={STATES} onChange={setState} label="Pull request state" />
          </div>
        </Show>
      </div>

      <Show when={stale()}>
        {(error) => <StaleBanner ctx={ctx} error={error()} directory={dir()} onRetry={retry} />}
      </Show>

      <div class="prr-scroll">
        <Show when={failure()}>
          {(error) => <ErrorState ctx={ctx} error={error()} directory={dir()} onRetry={retry} retrying={loading()} />}
        </Show>
        <Show when={!failure() && prs.latest === undefined}>
          <div class="prr-empty">
            <ui.Loader />
          </div>
        </Show>
        <Show when={!failure() && prs.latest && filtered().length === 0}>
          <div class="prr-empty prr-muted">
            <ui.Icon name="github" size="large" />
            <span>{emptyText()}</span>
          </div>
        </Show>
        <Show when={!failure()}>
          <For each={groups()}>
            {(group) => (
              <section class="prr-group">
                <Show when={group.title}>
                  <h3 class="prr-group-title">
                    {group.title}
                    <span class="prr-count">{group.items.length}</span>
                  </h3>
                </Show>
                <For each={group.items}>
                  {(pr) => (
                    <Row app={props.app} pr={pr} current={pr.number === currentNumber()} onOpen={(e) => open(pr, e)} />
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function Row(props: { app: App; pr: PrSummary; current: boolean; onOpen: (event: MouseEvent) => void }) {
  const ui = props.app.ctx.ui
  const pr = () => props.pr
  return (
    <button type="button" class="prr-row" onClick={(e) => props.onOpen(e)} title={`#${pr().number} ${pr().title}`}>
      <span class={`prr-row-icon prr-state-fg-${stateClass(pr())}`} title={stateLabel(pr())}>
        <ui.Icon name={stateIcon(pr())} size="small" />
      </span>
      <span class="prr-row-body">
        <span class="prr-row-line">
          <span class="prr-row-title prr-ellipsis">{pr().title}</span>
          <span class="prr-row-time prr-muted">{ago(pr().updatedAt)}</span>
        </span>
        <span class="prr-row-line prr-row-meta">
          <span class="prr-number">#{pr().number}</span>
          <span class="prr-ellipsis">
            {pr().author}
            <span class="prr-sep">·</span>
            <span class="prr-mono-inline">{pr().head}</span>
          </span>
          <Show when={props.current}>
            <span class="prr-chip prr-chip-accent">This branch</span>
          </Show>
          <Show when={pr().draft && pr().state === "OPEN"}>
            <span class="prr-chip">Draft</span>
          </Show>
          <Show when={pr().reviewDecision === "APPROVED"}>
            <span class="prr-chip prr-chip-success">Approved</span>
          </Show>
          <Show when={pr().reviewDecision === "CHANGES_REQUESTED"}>
            <span class="prr-chip prr-chip-danger">Changes requested</span>
          </Show>
          <span class="prr-spacer" />
          <Show when={pr().checks !== "none"}>
            <span class={`prr-row-check prr-tone-${pr().checks}`} title={checkLabel(pr().checks)}>
              <ui.Icon name={checkIcon(pr().checks)} size="small" />
            </span>
          </Show>
          <span class="prr-diffstat">
            <span class="prr-add">+{pr().additions}</span>
            <span class="prr-del">−{pr().deletions}</span>
          </span>
        </span>
      </span>
    </button>
  )
}

export function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div class="prr-seg" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.value}
            class="prr-seg-item"
            classList={{ "prr-seg-active": props.value === option.value }}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
            <Show when={option.count !== undefined}>
              <span class="prr-seg-count">{option.count}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  )
}
