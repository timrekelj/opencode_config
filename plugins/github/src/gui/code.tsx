import { createLatest, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Index, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { DraftComment, PrDetail, PrFile, ReviewComment, ReviewEvent, Side } from "../types"
import { ErrorState, showErrorToast, StaleBanner } from "./errors"
import { prKey, type App } from "./app"
import { ago, lineNumber, lineSide, parsePatch, type DiffLine } from "./util"

interface Selection {
  path: string
  side: Side
  start: number
  end: number
}

const STATUS: Record<string, { letter: string; tone: string }> = {
  added: { letter: "A", tone: "add" },
  removed: { letter: "D", tone: "del" },
  modified: { letter: "M", tone: "mod" },
  renamed: { letter: "R", tone: "mod" },
  copied: { letter: "C", tone: "mod" },
  changed: { letter: "M", tone: "mod" },
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
  const data = createLatest(
    () => `${dir()}\n${props.pr.number}\n${props.version}\n${local()}`,
    (k) => {
      const [d, n] = k.split("\n")
      return app.api.files(d, Number(n))
    },
  )

  const [viewed, setViewed] = createStore<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({})
  const [selection, setSelection] = createSignal<Selection>()
  const [filter, setFilter] = createSignal("")

  const files = () => data.latest?.files ?? []
  const isViewed = (file: PrFile) => viewed[file.path] ?? file.viewed === "VIEWED"
  const isCollapsed = (file: PrFile) => collapsed[file.path] ?? isViewed(file)
  const viewedCount = () => files().filter(isViewed).length
  const drafts = () => app.drafts[key()] ?? []

  const shown = createMemo(() => {
    const q = filter().trim().toLowerCase()
    return q ? files().filter((f) => f.path.toLowerCase().includes(q)) : files()
  })

  const comments = createMemo(() => {
    const byPath = new Map<string, ReviewComment[]>()
    for (const comment of data.latest?.comments ?? []) {
      const list = byPath.get(comment.path) ?? []
      list.push(comment)
      byPath.set(comment.path, list)
    }
    return byPath
  })

  const toggleViewed = async (file: PrFile) => {
    const next = !isViewed(file)
    setViewed(file.path, next)
    setCollapsed(file.path, next)
    try {
      await app.api.setViewed(dir(), props.pr.number, file.path, next)
    } catch (error) {
      setViewed(file.path, !next)
      showErrorToast(ctx, "Marking as viewed", error, dir())
    }
  }

  const select = (path: string, line: DiffLine, extend: boolean) => {
    const n = lineNumber(line)
    if (n === undefined) return
    const side = lineSide(line)
    const current = selection()
    if (extend && current && current.path === path && current.side === side) {
      setSelection({ path, side, start: Math.min(current.start, n), end: Math.max(current.start, n) })
      return
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
    const composer = ctx.screen.current()?.composer
    if (!composer?.quotable()) {
      ctx.toast.show({ title: "The chat composer is not available here." })
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
        label: `#${props.pr.number} ${file.path.split("/").pop()}:${sel.start === sel.end ? sel.end : `${sel.start}-${sel.end}`}`,
        icon: "github",
        subject: `the diff of ${file.path} (${range}, ${sel.side === "LEFT" ? "old" : "new"} side) in pull request #${props.pr.number} "${props.pr.title}"`,
      },
    })
    composer.focus(commentID)
    setSelection(undefined)
  }

  const reply = async (comment: ReviewComment, body: string) => {
    try {
      await app.api.reply(dir(), props.pr.number, comment.replyTo ?? comment.id, body)
      setLocal((v) => v + 1)
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
        setLocal((v) => v + 1)
        props.onSubmitted()
      },
    })

  return (
    <div class="prr-code">
      <div class="prr-code-toolbar">
        <span class="prr-progress" title="Files marked as viewed (synced with GitHub)">
          <ui.Icon name="eye" size="small" />
          {viewedCount()}/{files().length} viewed
        </span>
        <div class="prr-code-filter">
          <ui.TextInput label="Filter files" placeholder="Filter files" type="search" value={filter()} onInput={setFilter} />
        </div>
        <ui.Tooltip value="Collapse all">
          <ui.IconButton
            icon="collapse"
            label="Collapse all"
            variant="ghost"
            size="small"
            onClick={() => files().forEach((f) => setCollapsed(f.path, true))}
          />
        </ui.Tooltip>
        <ui.Tooltip value="Expand all">
          <ui.IconButton
            icon="expand"
            label="Expand all"
            variant="ghost"
            size="small"
            onClick={() => files().forEach((f) => setCollapsed(f.path, false))}
          />
        </ui.Tooltip>
        <ui.Button size="small" variant="contrast" icon="review" onClick={submit} disabled={props.pr.state !== "OPEN"}>
          {drafts().length ? `Review (${drafts().length})` : "Review"}
        </ui.Button>
      </div>

      <div class="prr-scroll">
        <Show when={data.error && !data.latest}>
          <ErrorState
            ctx={ctx}
            error={data.error}
            directory={dir()}
            onRetry={() => setLocal((v) => v + 1)}
            retrying={data.loading}
          />
        </Show>
        <Show when={data.error && data.latest}>
          <StaleBanner ctx={ctx} error={data.error} directory={dir()} onRetry={() => setLocal((v) => v + 1)} />
        </Show>
        <Show when={!data.latest && !data.error}>
          <div class="prr-empty">
            <ui.Loader />
          </div>
        </Show>
        <For each={shown()}>
          {(file) => (
            <FileDiff
              app={app}
              session={props.session}
              file={file}
              viewed={isViewed(file)}
              collapsed={isCollapsed(file)}
              comments={comments().get(file.path) ?? []}
              drafts={drafts().filter((d) => d.path === file.path)}
              selection={selection()?.path === file.path ? selection() : undefined}
              onToggleViewed={() => void toggleViewed(file)}
              onToggleCollapsed={() => setCollapsed(file.path, !isCollapsed(file))}
              onSelect={(line, extend) => select(file.path, line, extend)}
              onCancel={() => setSelection(undefined)}
              onDraft={(sel, body) => addDraft(sel, body)}
              onAsk={(sel, body) => askAgent(sel, file, body)}
              onRemoveDraft={(id) => app.updateDrafts(key(), (list) => list.filter((d) => d.id !== id))}
              onReply={reply}
              prUrl={props.pr.url}
            />
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
  comments: ReviewComment[]
  drafts: DraftComment[]
  selection: Selection | undefined
  prUrl: string
  onToggleViewed: () => void
  onToggleCollapsed: () => void
  onSelect: (line: DiffLine, extend: boolean) => void
  onCancel: () => void
  onDraft: (sel: Selection, body: string) => void
  onAsk: (sel: Selection, body: string) => void
  onRemoveDraft: (id: string) => void
  onReply: (comment: ReviewComment, body: string) => Promise<boolean>
}) {
  const ctx = props.app.ctx
  const ui = ctx.ui
  const lines = createMemo(() => (props.file.patch ? parsePatch(props.file.patch) : []))
  const status = () => STATUS[props.file.status] ?? { letter: "M", tone: "mod" }

  const threads = createMemo(() => {
    const roots = props.comments.filter((c) => c.replyTo === null && c.line !== null)
    return roots.map((root) => ({ root, replies: props.comments.filter((c) => c.replyTo === root.id) }))
  })

  const at = (line: DiffLine) => {
    const n = lineNumber(line)
    const side = lineSide(line)
    if (n === undefined || line.kind === "hunk" || line.kind === "note") return undefined
    return { n, side }
  }
  const threadsAt = (line: DiffLine) => {
    const pos = at(line)
    return pos ? threads().filter((t) => t.root.side === pos.side && t.root.line === pos.n) : []
  }
  const draftsAt = (line: DiffLine) => {
    const pos = at(line)
    return pos ? props.drafts.filter((d) => d.side === pos.side && d.line === pos.n) : []
  }
  const selected = (line: DiffLine) => {
    const pos = at(line)
    const sel = props.selection
    return !!pos && !!sel && sel.side === pos.side && pos.n >= sel.start && pos.n <= sel.end
  }
  const editorAt = (line: DiffLine) => {
    const pos = at(line)
    const sel = props.selection
    return !!pos && !!sel && sel.side === pos.side && sel.end === pos.n
  }

  const outdated = () => props.comments.filter((c) => c.replyTo === null && c.line === null).length

  return (
    <section class="prr-file" classList={{ "prr-file-viewed": props.viewed }}>
      <header class="prr-file-header">
        <button type="button" class="prr-file-toggle" onClick={props.onToggleCollapsed}>
          <ui.Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size="small" />
          <span class={`prr-file-status prr-file-status-${status().tone}`}>{status().letter}</span>
          <span class="prr-file-path prr-mono" title={props.file.path}>
            <Show when={props.file.previous}>
              <span class="prr-muted">{props.file.previous} → </span>
            </Show>
            {props.file.path}
          </span>
        </button>
        <span class="prr-file-stats">
          <Show when={props.comments.length > 0}>
            <span class="prr-inline prr-muted" title="Review comments">
              <ui.Icon name="comment" size="small" />
              {props.comments.length}
            </span>
          </Show>
          <span class="prr-add">+{props.file.additions}</span>
          <span class="prr-del">−{props.file.deletions}</span>
        </span>
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
        <label class="prr-viewed" title="Mark as viewed">
          <input type="checkbox" checked={props.viewed} onChange={props.onToggleViewed} />
          <span>Viewed</span>
        </label>
      </header>

      <Show when={!props.collapsed}>
        <Show
          when={props.file.patch}
          fallback={
            <div class="prr-file-empty prr-muted">
              Diff not available (binary or too large).{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), ctx.system.openExternal(`${props.prUrl}/files`))}>
                View on GitHub
              </a>
            </div>
          }
        >
          <Show when={outdated() > 0}>
            <div class="prr-file-empty prr-muted">
              {outdated()} outdated comment{outdated() === 1 ? "" : "s"} on this file are only visible on GitHub.
            </div>
          </Show>
          <div class="prr-diff" role="table">
            <Index each={lines()}>
              {(line) => (
                <>
                  <Show
                    when={line().kind !== "hunk"}
                    fallback={<div class="prr-diff-hunk prr-mono">{line().text}</div>}
                  >
                    <div
                      class={`prr-diff-line prr-diff-${line().kind}`}
                      classList={{ "prr-diff-selected": selected(line()) }}
                    >
                      <span class="prr-diff-num">{line().old ?? ""}</span>
                      <span class="prr-diff-num">{line().new ?? ""}</span>
                      <button
                        type="button"
                        class="prr-diff-add-comment"
                        title="Comment on this line (shift-click to select a range)"
                        onClick={(e) => props.onSelect(line(), e.shiftKey)}
                      >
                        +
                      </button>
                      <span class="prr-diff-code prr-mono">
                        <span class="prr-diff-marker">
                          {line().kind === "add" ? "+" : line().kind === "del" ? "-" : " "}
                        </span>
                        {line().text}
                      </span>
                    </div>
                  </Show>
                  <For each={threadsAt(line())}>
                    {(thread) => <Thread app={props.app} root={thread.root} replies={thread.replies} onReply={props.onReply} />}
                  </For>
                  <For each={draftsAt(line())}>
                    {(draft) => (
                      <div class="prr-inline-card prr-draft">
                        <div class="prr-event-head">
                          <span class="prr-pill prr-state-draft">Pending</span>
                          <Show when={draft.startLine}>
                            <span class="prr-muted">
                              lines {draft.startLine}–{draft.line}
                            </span>
                          </Show>
                          <span class="prr-spacer" />
                          <ui.IconButton
                            icon="trash"
                            label="Delete pending comment"
                            variant="ghost"
                            size="small"
                            onClick={() => props.onRemoveDraft(draft.id)}
                          />
                        </div>
                        <ui.Markdown text={draft.body} class="prr-markdown" />
                      </div>
                    )}
                  </For>
                  <Show when={editorAt(line()) && props.selection}>
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
      <div class="prr-muted prr-editor-label">Comment on {range()}</div>
      <textarea
        class="prr-textarea"
        placeholder="Leave a review comment, or ask the agent about these lines"
        value={body()}
        ref={(el) => queueMicrotask(() => el.focus())}
        onInput={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel()
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body().trim()) props.onDraft(body())
        }}
      />
      <div class="prr-compose-actions">
        <ui.Button size="small" variant="ghost" onClick={props.onCancel}>
          Cancel
        </ui.Button>
        <ui.Button size="small" icon="prompt" onClick={() => props.onAsk(body())}>
          Ask agent
        </ui.Button>
        <ui.Button size="small" variant="contrast" disabled={!body().trim()} onClick={() => props.onDraft(body())}>
          Add to review
        </ui.Button>
      </div>
    </div>
  )
}

function Thread(props: {
  app: App
  root: ReviewComment
  replies: ReviewComment[]
  onReply: (comment: ReviewComment, body: string) => Promise<boolean>
}) {
  const ui = props.app.ctx.ui
  const [replying, setReplying] = createSignal(false)
  const [body, setBody] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const send = async () => {
    if (!body().trim()) return
    setSending(true)
    const ok = await props.onReply(props.root, body())
    setSending(false)
    if (ok) {
      setBody("")
      setReplying(false)
    }
  }

  return (
    <div class="prr-inline-card prr-thread">
      <For each={[props.root, ...props.replies]}>
        {(comment) => (
          <div class="prr-thread-comment">
            <div class="prr-event-head">
              <span class="prr-strong">{comment.author}</span>
              <span class="prr-muted">{ago(comment.createdAt)}</span>
              <span class="prr-spacer" />
              <ui.IconButton
                icon="square-arrow-top-right"
                label="Open on GitHub"
                variant="ghost"
                size="small"
                onClick={() => props.app.ctx.system.openExternal(comment.url)}
              />
            </div>
            <ui.Markdown text={comment.body} class="prr-markdown" />
          </div>
        )}
      </For>
      <Show
        when={replying()}
        fallback={
          <button type="button" class="prr-reply-button prr-muted" onClick={() => setReplying(true)}>
            Reply…
          </button>
        }
      >
        <textarea
          class="prr-textarea"
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

const EVENTS: { value: ReviewEvent; label: string; description: string }[] = [
  { value: "COMMENT", label: "Comment", description: "Submit general feedback without explicit approval." },
  { value: "APPROVE", label: "Approve", description: "Give your approval to merge these changes." },
  { value: "REQUEST_CHANGES", label: "Request changes", description: "Submit feedback that must be addressed." },
]

function openReviewDialog(
  app: App,
  input: { pr: PrDetail; drafts: DraftComment[]; directory: string; onDone: () => void },
) {
  const ctx = app.ctx
  const ui = ctx.ui

  ctx.dialogs.open((dialog) => {
    const [body, setBody] = createSignal("")
    const [event, setEvent] = createSignal<ReviewEvent>("COMMENT")
    const [sending, setSending] = createSignal(false)
    const empty = () => event() === "COMMENT" && !body().trim() && input.drafts.length === 0

    const send = async () => {
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
            ? `${input.drafts.length} pending comment${input.drafts.length === 1 ? "" : "s"} will be submitted.`
            : undefined
        }
        size="normal"
        footer={
          <>
            <ui.Button variant="ghost" onClick={dialog.close}>
              Cancel
            </ui.Button>
            <ui.Button variant="contrast" busy={sending()} disabled={empty()} onClick={() => void send()}>
              Submit review
            </ui.Button>
          </>
        }
      >
        <div class="prr-review-dialog">
          <textarea
            class="prr-textarea prr-textarea-tall"
            placeholder="Leave a summary (optional)"
            value={body()}
            onInput={(e) => setBody(e.currentTarget.value)}
          />
          <For each={EVENTS}>
            {(option) => (
              <label class="prr-radio">
                <input
                  type="radio"
                  name="prr-review-event"
                  checked={event() === option.value}
                  onChange={() => setEvent(option.value)}
                />
                <span>
                  <span class="prr-strong">{option.label}</span>
                  <span class="prr-muted"> — {option.description}</span>
                </span>
              </label>
            )}
          </For>
        </div>
      </ui.Dialog>
    )
  })
}
