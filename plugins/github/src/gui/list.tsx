import { createLatest, type MountedSession } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { ListState, PrSummary } from "../types"
import type { App } from "./app"
import { ErrorState } from "./errors"
import { ago, checkIcon, checkLabel, stateClass, stateLabel } from "./util"

const STATES: { value: ListState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
  { value: "all", label: "All" },
]

export function ListView(props: { app: App; session: MountedSession }) {
  const ui = props.app.ctx.ui
  const [query, setQuery] = createSignal("")
  const [state, setState] = createSignal<ListState>("open")
  const [version, setVersion] = createSignal(0)

  const repo = createLatest(
    () => `${props.session.directory}\n${version()}`,
    (key) => props.app.api.repo(key.split("\n")[0]),
  )
  // Only list once the repository resolves, so a broken repo shows one error instead of two.
  const prs = createLatest(
    () => (repo.latest && !repo.error ? `${props.session.directory}\n${state()}\n${version()}` : undefined),
    (key) => {
      const [dir, s] = key.split("\n")
      return props.app.api.list(dir, s as ListState)
    },
  )

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    const list = prs.latest ?? []
    if (!q) return list
    return list.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q.replace(/^#/, "")) ||
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
      { id: "mine", title: "Your pull requests", items: mine },
      { id: "rest", title: "Everything else", items: rest },
    ].filter((g) => g.items.length > 0)
  })

  const failure = () => repo.error ?? prs.error
  const retry = () => setVersion((v) => v + 1)

  const open = (pr: PrSummary, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) return props.app.ctx.system.openExternal(pr.url)
    props.app.openPr(props.session, pr.number)
  }

  return (
    <div class="prr-root">
      <div class="prr-toolbar">
        <div class="prr-toolbar-title">
          <span class="prr-strong">Pull requests</span>
          <Show when={repo.latest}>{(r) => <span class="prr-muted prr-ellipsis">{r().nameWithOwner}</span>}</Show>
        </div>
        <Show when={!failure()}>
          <ui.Menu
            label={STATES.find((s) => s.value === state())!.label}
            trigger="button"
            placement="bottom-end"
            items={STATES.map((s) => ({ label: s.label, onSelect: () => setState(s.value) }))}
          />
        </Show>
        <ui.Tooltip value="Refresh">
          <ui.IconButton
            icon="refresh"
            label="Refresh"
            variant="ghost"
            size="small"
            busy={repo.loading || prs.loading}
            onClick={retry}
          />
        </ui.Tooltip>
      </div>
      <Show when={!failure()}>
        <div class="prr-search">
          <ui.TextInput
            label="Search pull requests"
            placeholder="Search by title, #number, branch, author, label"
            type="search"
            value={query()}
            onInput={setQuery}
          />
        </div>
      </Show>

      <div class="prr-scroll">
        <Show when={failure()}>
          {(error) => (
            <ErrorState
              ctx={props.app.ctx}
              error={error()}
              directory={props.session.directory}
              onRetry={retry}
              retrying={repo.loading || prs.loading}
            />
          )}
        </Show>
        <Show when={!failure() && prs.latest === undefined}>
          <div class="prr-empty">
            <ui.Loader />
          </div>
        </Show>
        <Show when={!failure() && prs.latest && filtered().length === 0}>
          <div class="prr-empty prr-muted">
            <ui.Icon name="github" size="large" />
            <span>
              {query()
                ? "No pull requests match your search."
                : `No ${state() === "all" ? "" : `${STATES.find((s) => s.value === state())!.label.toLowerCase()} `}pull requests in this repository.`}
            </span>
          </div>
        </Show>
        <For each={failure() ? [] : groups()}>
          {(group) => (
            <section class="prr-group">
              <div class="prr-group-title">
                {group.title}
                <span class="prr-count">{group.items.length}</span>
              </div>
              <For each={group.items}>
                {(pr) => (
                  <button type="button" class="prr-row" onClick={(e) => open(pr, e)} title={pr.title}>
                    <span class={`prr-check prr-tone-${pr.checks}`} title={checkLabel(pr.checks)}>
                      <ui.Icon name={checkIcon(pr.checks)} size="small" />
                    </span>
                    <span class="prr-row-main">
                      <span class="prr-row-title">
                        <span class="prr-ellipsis">{pr.title}</span>
                        <span class="prr-muted prr-number">#{pr.number}</span>
                      </span>
                      <span class="prr-row-meta prr-muted">
                        <Show when={pr.draft || pr.state !== "OPEN"}>
                          <span class={`prr-pill prr-state-${stateClass(pr)}`}>{stateLabel(pr)}</span>
                        </Show>
                        <Show when={pr.reviewDecision === "APPROVED"}>
                          <span class="prr-pill prr-state-open">Approved</span>
                        </Show>
                        <Show when={pr.reviewDecision === "CHANGES_REQUESTED"}>
                          <span class="prr-pill prr-state-closed">Changes requested</span>
                        </Show>
                        <span>{pr.author}</span>
                        <span>·</span>
                        <span class="prr-ellipsis prr-mono">{pr.head}</span>
                        <span>·</span>
                        <span>{ago(pr.updatedAt)}</span>
                        <span class="prr-add">+{pr.additions}</span>
                        <span class="prr-del">−{pr.deletions}</span>
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </section>
          )}
        </For>
      </div>
    </div>
  )
}
