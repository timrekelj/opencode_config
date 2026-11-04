import { createLatest, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { createMemo, createSelector, createSignal, For, Index, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { DraftComment, PrDetail, PrFile, ReviewComment, ReviewEvent, Side } from "../types"
import { ErrorState, showErrorToast, StaleBanner } from "./errors"
import { prKey, type App } from "./app"
import { ago, lineNumber, lineSide, parsePatch, plural, splitPath, type DiffLine } from "./util"

interface Selection {
  path: string
  side: Side
  start: number
  end: number
}

interface Thread {
  root: ReviewComment
  replies: ReviewComment[]
}

const STATUS: Record<string, { letter: string; tone: string; label: string }> = {
  added: { letter: "A", tone: "add", label: "Added" },
  removed: { letter: "D", tone: "del", label: "Deleted" },
  modified: { letter: "M", tone: "mod", label: "Modified" },
  renamed: { letter: "R", tone: "mod", label: "Renamed" },
  copied: { letter: "C", tone: "mod", label: "Copied" },
  changed: { letter: "M", tone: "mod", label: "Changed" },
}

export function CodeTab(props: {
  app: App
  session: MountedSession
  screen: SessionScreen
  pr: PrDetail
  version: number
  onSubmitted: () => void
}) {
  const app = props.app
  const ctx = app.ctx
  const ui = ctx.ui
  const dir = () => props.session.directory
  const key = () => prKey(dir(), props.pr.number)

  const [local, setLocal] = createSignal(0)
  const reload = () => setLocal((v) => v + 1)
  const data = createLatest(
    () => `${dir()}\n${props.pr.number}\n${props.version}\n${local()}`,
    (k, signal) => {
      const [d, n] = k.split("\n")
      return app.api.files(d, Number(n), signal)
    },
  )

  // Local "viewed" overrides: `loaded` is undefined while the change is in flight, then the response it was made
  // against. Once a newer response arrives, GitHub's state wins again (it resets files to DISMISSED on new commits).
  const [viewed, setViewed] = createStore<Record<string, { viewed: boolean; loaded?: number } | undefined>>({})
  // Manual collapse toggles; without one, a file is collapsed while it is viewed.
  const [collapsed, setCollapsed] = createStore<Record<string, boolean | undefined>>({})
  const [selection, setSelection] = createSignal<Selection>()
  const [filter, setFilter] = createSignal("")

  const loaded = createMemo((n: number) => (data.latest ? n + 1 : n), 0)
  const files = () => data.latest?.files ?? []
  // Fresh file objects arrive with every reload; rows key by path so their diff and editors survive it.
  const byPath = createMemo(() => new Map(files().map((f) => [f.path, f])))
  const isViewed = (file: PrFile) => {
    const local = viewed[file.path]
    return local && (local.loaded === undefined || local.loaded === loaded()) ? local.viewed : file.viewed === "VIEWED"
  }
  const isCollapsed = (file: PrFile) => collapsed[file.path] ?? isViewed(file)
  const viewedCount = () => files().filter(isViewed).length
  const allCollapsed = () => files().length > 0 && files().every(isCollapsed)
  const drafts = () => app.drafts[key()] ?? []

  const shown = createMemo(() => {
    const q = filter().trim().toLowerCase()
    const paths = files().map((f) => f.path)
    return q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths
  })

  const threads = createMemo(() => {
    const comments = data.latest?.comments ?? []
    const replies = new Map<number, ReviewComment[]>()
    for (const c of comments) {
      if (c.replyTo === null) continue
      const list = replies.get(c.replyTo) ?? []
      list.push(c)
      replies.set(c.replyTo, list)
    }
    const byPath = new Map<string, Thread[]>()
    for (const root of comments) {
      if (root.replyTo !== null) continue
      const list = byPath.get(root.path) ?? []
      list.push({ root, replies: replies.get(root.id) ?? [] })
      byPath.set(root.path, list)
    }
    return byPath
  })

  const toggleViewed = async (file: PrFile) => {
    const path = file.path
    const next = !isViewed(file)
    setViewed(path, { viewed: next, loaded: undefined })
    setCollapsed(path, undefined)
    try {
      await app.api.setViewed(dir(), props.pr.number, path, next)
      setViewed(path, { viewed: next, loaded: loaded() })
    } catch (error) {
      setViewed(path, undefined)
      showErrorToast(ctx, "Marking as viewed", error, dir())
    }
  }

  const select = (path: string, line: DiffLine, extend: boolean, lines: DiffLine[]) => {
    const n = lineNumber(line)
    if (n === undefined) return
    const side = lineSide(line)
    const current = selection()
    if (extend && current && current.path === path && current.side === side) {
      const start = Math.min(current.start, n)
      const end = Math.max(current.end, n)
      // GitHub rejects a multi-line comment that spans hunks; start over from the clicked line instead.
      if (!spansHunks(lines, side, start, end)) {
        setSelection({ path, side, start, end })
        return
      }
    }
    setSelection({ path, side, start: n, end: n })
  }

  const addDraft = (sel: Selection, body: string) => {
    app.updateDrafts(key(), (list) => [
      ...list,
      {
        id: crypto.randomUUID(),
        path: sel.path,
        side: sel.side,
        line: sel.end,
        startLine: sel.start !== sel.end ? sel.start : undefined,
        body,
      },
    ])
    setSelection(undefined)
  }

  const askAgent = (sel: Selection, file: PrFile, body: string) => {
    const composer = props.screen.composer
    if (!composer.quotable()) {
      ctx.toast.show({ title: "The chat composer isn't available here." })
      return
    }
    const lines = parsePatch(file.patch ?? "").filter((l) => {
      const n = lineNumber(l)
      return l.kind !== "hunk" && l.kind !== "note" && lineSide(l) === sel.side && n !== undefined && n >= sel.start && n <= sel.end
    })
    const range = sel.start === sel.end ? `line ${sel.end}` : `lines ${sel.start}-${sel.end}`
    const commentID = crypto.randomUUID()
    composer.attach({
      type: "quote",
      commentID,
      text: lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`).join("\n"),
      comment: body.trim() || undefined,
      source: {
        label: `#${props.pr.number} ${splitPath(file.path)[1]}:${sel.start === sel.end ? sel.end : `${sel.start}-${sel.end}`}`,
        icon: "github",
        subject: `the diff of ${file.path} (${range}, ${sel.side === "LEFT" ? "old" : "new"} side) in pull request #${props.pr.number} "${props.pr.title}"`,
      },
    })
    composer.focus(commentID)
    setSelection(undefined)
  }

  const reply = async (thread: Thread, body: string) => {
    try {
      await app.api.reply(dir(), props.pr.number, thread.root.id, body)
      reload()
      return true
    } catch (error) {
      showErrorToast(ctx, "Reply", error, dir())
      return false
    }
  }

  const submit = () =>
    openReviewDialog(app, {
      pr: props.pr,
      drafts: drafts(),
      directory: dir(),
      onDone: () => {
        app.updateDrafts(key(), () => [])
        props.onSubmitted()
      },
    })

  return (
    <div class="prr-code">
      <div class="prr-code-toolbar">
        <div class="prr-progress" title="Files you marked as viewed, synced with GitHub">
          <span class="prr-progress-text">
            {viewedCount()} / {files().length} viewed
          </span>
          <span class="prr-progress-bar">
            <span
              class="prr-progress-fill"
              style={{ width: `${files().length ? (viewedCount() / files().length) * 100 : 0}%` }}
            />
          </span>
        </div>
        <div class="prr-grow">
          <ui.TextInput label="Filter files" placeholder="Filter files" type="search" value={filter()} onInput={setFilter} />
        </div>
        <ui.Tooltip value={allCollapsed() ? "Expand all" : "Collapse all"}>
          <ui.IconButton
            icon={allCollapsed() ? "expand" : "collapse"}
            label={allCollapsed() ? "Expand all" : "Collapse all"}
            variant="ghost"
            size="small"
            onClick={() => {
              const next = !allCollapsed()
              files().forEach((f) => setCollapsed(f.path, next))
            }}
          />
        </ui.Tooltip>
        <Show when={props.pr.state === "OPEN"}>
          <ui.Button size="small" variant="contrast" icon="review" onClick={submit}>
            {drafts().length ? `Submit review (${drafts().length})` : "Review"}
          </ui.Button>
        </Show>
      </div>

      <Show when={data.error && data.latest}>
        <StaleBanner ctx={ctx} error={data.error} directory={dir()} onRetry={reload} />
      </Show>

      <div class="prr-scroll prr-files">
        <Show when={data.error && !data.latest}>
          <ErrorState ctx={ctx} error={data.error} directory={dir()} onRetry={reload} retrying={data.loading} />
        </Show>
        <Show when={!data.latest && !data.error}>
          <div class="prr-empty">
            <ui.Loader />
          </div>
        </Show>
        <Show when={data.latest && shown().length === 0}>
          <div class="prr-empty prr-muted">{filter() ? "No files match the filter." : "No files changed."}</div>
        </Show>
        <For each={shown()}>
          {(path) => (
            <Show when={byPath().get(path)}>
              {(file) => (
                <FileDiff
                  app={app}
                  session={props.session}
                  file={file()}
                  viewed={isViewed(file())}
                  collapsed={isCollapsed(file())}
                  threads={threads().get(path) ?? []}
                  drafts={drafts().filter((d) => d.path === path)}
                  selection={selection()?.path === path ? selection() : undefined}
                  prUrl={props.pr.url}
                  onToggleViewed={() => void toggleViewed(file())}
                  onToggleCollapsed={() => setCollapsed(path, !isCollapsed(file()))}
                  onSelect={(line, extend, lines) => select(path, line, extend, lines)}
                  onCancel={() => setSelection(undefined)}
                  onDraft={(sel, body) => addDraft(sel, body)}
                  onAsk={(sel, body) => askAgent(sel, file(), body)}
                  onRemoveDraft={(id) => app.updateDrafts(key(), (list) => list.filter((d) => d.id !== id))}
                  onReply={reply}
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
  )
}

function FileDiff(props: {
  app: App
  session: MountedSession
  file: PrFile
  viewed: boolean
  collapsed: boolean
  threads: Thread[]
  drafts: DraftComment[]
  selection: Selection | undefined
  prUrl: string
  onToggleViewed: () => void
  onToggleCollapsed: () => void
  onSelect: (line: DiffLine, extend: boolean, lines: DiffLine[]) => void
  onCancel: () => void
  onDraft: (sel: Selection, body: string) => void
  onAsk: (sel: Selection, body: string) => void
  onRemoveDraft: (id: string) => void
  onReply: (thread: Thread, body: string) => Promise<boolean>
}) {
  const ctx = props.app.ctx
  const ui = ctx.ui
  // Keyed on the patch text, so a reload with an unchanged patch doesn't re-parse or re-render the diff.
  const patch = createMemo(() => props.file.patch)
  const lines = createMemo(() => {
    const text = patch()
    return text ? parsePatch(text) : []
  })
  const status = () => STATUS[props.file.status] ?? STATUS.modified
  const path = () => splitPath(props.file.path)
  const commentCount = () => props.threads.reduce((n, t) => n + 1 + t.replies.length, 0)
  // Threads render by root id, so a reload keeps their cards (and any reply being written) in place.
  const threadById = createMemo(() => new Map(props.threads.map((t) => [t.root.id, t])))
  const outdated = createMemo(() => props.threads.filter((t) => t.root.line === null).map((t) => t.root.id))
  const threadIds = createMemo(() => {
    const map = new Map<string, number[]>()
    for (const t of props.threads) if (t.root.line !== null) push(map, `${t.root.side}:${t.root.line}`, t.root.id)
    return map
  })
  const draftMap = createMemo(() => {
    const map = new Map<string, DraftComment[]>()
    for (const d of props.drafts) push(map, `${d.side}:${d.line}`, d)
    return map
  })
  // Only this file's rows react to selection changes, and only the rows whose state flips.
  const selection = createMemo(() => props.selection)

  const at = (line: DiffLine) => {
    const n = lineNumber(line)
    if (n === undefined || line.kind === "hunk" || line.kind === "note") return undefined
    return { n, side: lineSide(line) }
  }
  const threadsAt = (line: DiffLine) => positions(line).flatMap((k) => threadIds().get(k) ?? [])
  const draftsAt = (line: DiffLine) => positions(line).flatMap((k) => draftMap().get(k) ?? [])
  const selected = createSelector(selection, (line: DiffLine, sel) => {
    const pos = at(line)
    return !!pos && !!sel && sel.side === pos.side && pos.n >= sel.start && pos.n <= sel.end
  })
  const editorAt = createSelector(selection, (line: DiffLine, sel) => {
    const pos = at(line)
    return !!pos && !!sel && sel.side === pos.side && sel.end === pos.n
  })

  return (
    <section class="prr-file" classList={{ "prr-file-viewed": props.viewed }}>
      <header class="prr-file-header">
        <button
          type="button"
          class="prr-file-toggle"
          aria-expanded={!props.collapsed}
          title={props.file.previous ? `${props.file.previous} → ${props.file.path}` : props.file.path}
          onClick={props.onToggleCollapsed}
        >
          <ui.Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size="small" />
          <span class={`prr-file-status prr-file-status-${status().tone}`} title={status().label}>
            {status().letter}
          </span>
          <span class="prr-file-path">
            <span class="prr-file-dir">{path()[0]}</span>
            <span class="prr-file-name">{path()[1]}</span>
            <Show when={props.file.previous}>
              {(previous) => <span class="prr-file-from">from {previous()}</span>}
            </Show>
          </span>
        </button>
        <Show when={commentCount() > 0}>
          <span class="prr-inline prr-muted prr-file-comments" title={plural(commentCount(), "comment")}>
            <ui.Icon name="comment" size="small" />
            {commentCount()}
          </span>
        </Show>
        <Show when={props.file.additions || props.file.deletions}>
          <span class="prr-diffstat">
            <span class="prr-add">+{props.file.additions}</span>
            <span class="prr-del">−{props.file.deletions}</span>
          </span>
        </Show>
        <ui.Tooltip value="Open file">
          <ui.IconButton
            icon="open-file"
            label="Open file"
            variant="ghost"
            size="small"
            disabled={props.file.status === "removed"}
            onClick={() => ctx.links.open({ href: props.file.path, exact: true, session: props.session })}
          />
        </ui.Tooltip>
        <label class="prr-viewed" classList={{ "prr-viewed-on": props.viewed }} title="Mark as viewed">
          <input type="checkbox" checked={props.viewed} onChange={props.onToggleViewed} />
          <span class="prr-viewed-box">
            <Show when={props.viewed}>
              <ui.Icon name="check-small" size="small" />
            </Show>
          </span>
          Viewed
        </label>
      </header>

      <Show when={!props.collapsed}>
        <Show when={outdated().length > 0}>
          <div class="prr-outdated">
            <For each={outdated()}>
              {(id) => (
                <Show when={threadById().get(id)}>
                  {(thread) => (
                    <ThreadCard
                      app={props.app}
                      thread={thread()}
                      outdated
                      onReply={(body) => props.onReply(thread(), body)}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
        </Show>
        <Show
          when={props.file.patch}
          fallback={
            <div class="prr-file-note prr-muted">
              {props.file.status === "renamed" && !props.file.additions && !props.file.deletions
                ? "File renamed without changes."
                : "No diff to show (binary or too large)."}{" "}
              <button
                type="button"
                class="prr-link"
                onClick={() => ctx.system.openExternal(`${props.prUrl}/files`)}
              >
                View on GitHub
              </button>
            </div>
          }
        >
          <div class="prr-diff">
            <Index each={lines()}>
              {(line) => (
                <>
                  <Show
                    when={line().kind !== "hunk"}
                    fallback={<div class="prr-diff-hunk">{line().text}</div>}
                  >
                    <div
                      class={`prr-diff-line prr-diff-${line().kind}`}
                      classList={{ "prr-diff-selected": selected(line()) }}
                    >
                      <span class="prr-diff-num">{line().old ?? ""}</span>
                      <span class="prr-diff-num">{line().new ?? ""}</span>
                      <span class="prr-diff-gutter">
                        <Show when={line().kind !== "note"}>
                          <button
                            type="button"
                            class="prr-diff-plus"
                            aria-label="Comment on this line"
                            title="Comment on this line (shift-click to extend the range)"
                            onClick={(e) => props.onSelect(line(), e.shiftKey, lines())}
                          >
                            <ui.Icon name="plus-small" size="small" />
                          </button>
                        </Show>
                      </span>
                      <span class="prr-diff-code">
                        <span class="prr-diff-marker">
                          {line().kind === "add" ? "+" : line().kind === "del" ? "−" : ""}
                        </span>
                        {line().text}
                      </span>
                    </div>
                  </Show>
                  <For each={threadsAt(line())}>
                    {(id) => (
                      <Show when={threadById().get(id)}>
                        {(thread) => (
                          <ThreadCard app={props.app} thread={thread()} onReply={(body) => props.onReply(thread(), body)} />
                        )}
                      </Show>
                    )}
                  </For>
                  <For each={draftsAt(line())}>
                    {(draft) => (
                      <div class="prr-inline-card prr-draft">
                        <div class="prr-inline-head">
                          <span class="prr-chip">Pending</span>
                          <Show when={draft.startLine}>
                            <span class="prr-muted">
                              Lines {draft.startLine}–{draft.line}
                            </span>
                          </Show>
                          <span class="prr-spacer" />
                          <ui.Tooltip value="Delete pending comment">
                            <ui.IconButton
                              icon="trash"
                              label="Delete pending comment"
                              variant="ghost"
                              size="small"
                              onClick={() => props.onRemoveDraft(draft.id)}
                            />
                          </ui.Tooltip>
                        </div>
                        <ui.Markdown text={draft.body} class="prr-markdown" />
                      </div>
                    )}
                  </For>
                  <Show when={editorAt(line()) && selection()}>
                    {(sel) => (
                      <LineEditor
                        app={props.app}
                        selection={sel()}
                        onCancel={props.onCancel}
                        onDraft={(body) => props.onDraft(sel(), body)}
                        onAsk={(body) => props.onAsk(sel(), body)}
                      />
                    )}
                  </Show>
                </>
              )}
            </Index>
          </div>
        </Show>
      </Show>
    </section>
  )
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** The `side:line` positions a comment on this diff line can have; a context line exists on both sides. */
function positions(line: DiffLine): string[] {
  if (line.kind === "add") return [`RIGHT:${line.new}`]
  if (line.kind === "del") return [`LEFT:${line.old}`]
  if (line.kind === "ctx") return [`RIGHT:${line.new}`, `LEFT:${line.old}`]
  return []
}

/** Whether lines `start`–`end` on `side` cross a hunk header. */
function spansHunks(lines: DiffLine[], side: Side, start: number, end: number) {
  let first = -1
  let last = -1
  lines.forEach((l, i) => {
    if (l.kind === "hunk" || l.kind === "note" || lineSide(l) !== side) return
    const n = lineNumber(l)
    if (n === undefined || n < start || n > end) return
    if (first === -1) first = i
    last = i
  })
  return first !== -1 && lines.slice(first, last).some((l) => l.kind === "hunk")
}

function LineEditor(props: {
  app: App
  selection: Selection
  onCancel: () => void
  onDraft: (body: string) => void
  onAsk: (body: string) => void
}) {
  const ui = props.app.ctx.ui
  const [body, setBody] = createSignal("")
  const range = () =>
    props.selection.start === props.selection.end
      ? `line ${props.selection.end}`
      : `lines ${props.selection.start}–${props.selection.end}`

  return (
    <div class="prr-inline-card prr-editor">
      <div class="prr-inline-head prr-muted">
        Comment on {range()}
        <Show when={props.selection.side === "LEFT"}> (old version)</Show>
      </div>
      <textarea
        class="prr-textarea"
        placeholder="Write a review comment, or a question for the agent"
        value={body()}
        ref={(el) => queueMicrotask(() => el.focus())}
        onInput={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel()
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body().trim()) props.onDraft(body())
        }}
      />
      <div class="prr-compose-actions">
        <ui.Button size="small" variant="ghost" icon="prompt" onClick={() => props.onAsk(body())}>
          Ask agent
        </ui.Button>
        <span class="prr-spacer" />
        <ui.Button size="small" variant="ghost" onClick={props.onCancel}>
          Cancel
        </ui.Button>
        <ui.Button size="small" variant="contrast" disabled={!body().trim()} onClick={() => props.onDraft(body())}>
          Add to review
        </ui.Button>
      </div>
    </div>
  )
}

function ThreadCard(props: { app: App; thread: Thread; outdated?: boolean; onReply: (body: string) => Promise<boolean> }) {
  const ui = props.app.ctx.ui
  const [replying, setReplying] = createSignal(false)
  const [body, setBody] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const send = async () => {
    if (!body().trim() || sending()) return
    setSending(true)
    const ok = await props.onReply(body())
    setSending(false)
    if (ok) {
      setBody("")
      setReplying(false)
    }
  }

  return (
    <div class="prr-inline-card prr-thread">
      <Show when={props.outdated}>
        <div class="prr-inline-head">
          <span class="prr-chip prr-chip-warning">Outdated</span>
          <Show when={props.thread.root.originalLine}>
            {(line) => <span class="prr-muted">Was on line {line()}</span>}
          </Show>
        </div>
      </Show>
      <For each={[props.thread.root, ...props.thread.replies]}>
        {(comment) => (
          <div class="prr-thread-comment">
            <div class="prr-inline-head">
              <span class="prr-strong">{comment.author}</span>
              <span class="prr-muted">{ago(comment.createdAt)}</span>
              <span class="prr-spacer" />
              <ui.Tooltip value="Open on GitHub">
                <ui.IconButton
                  icon="square-arrow-top-right"
                  label="Open on GitHub"
                  variant="ghost"
                  size="small"
                  onClick={() => props.app.ctx.system.openExternal(comment.url)}
                />
              </ui.Tooltip>
            </div>
            <ui.Markdown text={comment.body} class="prr-markdown" />
          </div>
        )}
      </For>
      <Show
        when={replying()}
        fallback={
          <button type="button" class="prr-reply-button" onClick={() => setReplying(true)}>
            Reply…
          </button>
        }
      >
        <textarea
          class="prr-textarea prr-reply-input"
          placeholder="Reply"
          value={body()}
          ref={(el) => queueMicrotask(() => el.focus())}
          onInput={(e) => setBody(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setReplying(false)
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send()
          }}
        />
        <div class="prr-compose-actions">
          <span class="prr-spacer" />
          <ui.Button size="small" variant="ghost" onClick={() => setReplying(false)}>
            Cancel
          </ui.Button>
          <ui.Button size="small" variant="contrast" busy={sending()} disabled={!body().trim()} onClick={() => void send()}>
            Reply
          </ui.Button>
        </div>
      </Show>
    </div>
  )
}

const EVENTS: { value: ReviewEvent; label: string; description: string; own: boolean }[] = [
  { value: "COMMENT", label: "Comment", description: "General feedback, without approving.", own: true },
  { value: "APPROVE", label: "Approve", description: "Approve merging these changes.", own: false },
  { value: "REQUEST_CHANGES", label: "Request changes", description: "Feedback that must be addressed first.", own: false },
]

function openReviewDialog(
  app: App,
  input: { pr: PrDetail; drafts: DraftComment[]; directory: string; onDone: () => void },
) {
  const ctx = app.ctx
  const ui = ctx.ui
  const own = input.pr.author === input.pr.viewer

  ctx.dialogs.open((dialog) => {
    const [body, setBody] = createSignal("")
    const [event, setEvent] = createSignal<ReviewEvent>("COMMENT")
    const [sending, setSending] = createSignal(false)
    // GitHub rejects an empty comment review and a request for changes without a summary.
    const invalid = () =>
      (event() === "COMMENT" && !body().trim() && input.drafts.length === 0) ||
      (event() === "REQUEST_CHANGES" && !body().trim())

    const send = async () => {
      if (sending()) return
      setSending(true)
      try {
        await app.api.submitReview(input.directory, input.pr.number, {
          event: event(),
          body: body(),
          commit: input.pr.headOid,
          comments: input.drafts,
        })
        ctx.toast.show({ variant: "success", title: `Review submitted on #${input.pr.number}` })
        dialog.close()
        input.onDone()
      } catch (error) {
        showErrorToast(ctx, "Submitting the review", error, input.directory)
      } finally {
        setSending(false)
      }
    }

    return (
      <ui.Dialog
        title={`Review #${input.pr.number}`}
        description={
          input.drafts.length
            ? `${plural(input.drafts.length, "pending comment")} will be submitted with the review.`
            : "Leave a summary and choose how to review."
        }
        size="fit"
        footer={
          <>
            <ui.Button variant="ghost" onClick={dialog.close}>
              Cancel
            </ui.Button>
            <ui.Button variant="contrast" busy={sending()} disabled={invalid()} onClick={() => void send()}>
              Submit review
            </ui.Button>
          </>
        }
      >
        <div class="prr-dialog">
          <textarea
            class="prr-textarea prr-textarea-tall"
            placeholder={event() === "REQUEST_CHANGES" ? "Describe the changes you need (required)" : "Summary (optional)"}
            value={body()}
            ref={(el) => queueMicrotask(() => el.focus())}
            onInput={(e) => setBody(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !invalid()) void send()
            }}
          />
          <div class="prr-options" role="radiogroup" aria-label="Review type">
            <For each={EVENTS}>
              {(option) => (
                <label
                  class="prr-option"
                  classList={{ "prr-option-active": event() === option.value, "prr-option-disabled": own && !option.own }}
                >
                  <input
                    type="radio"
                    name="prr-review-event"
                    checked={event() === option.value}
                    disabled={own && !option.own}
                    onChange={() => setEvent(option.value)}
                  />
                  <span class="prr-option-text">
                    <span class="prr-strong">{option.label}</span>
                    <span class="prr-muted">
                      {own && !option.own ? "You can't do this on your own pull request." : option.description}
                    </span>
                  </span>
                </label>
              )}
            </For>
          </div>
        </div>
      </ui.Dialog>
    )
  })
}
