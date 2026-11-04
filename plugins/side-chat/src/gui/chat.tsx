import type { Context, MountedSession, SessionRef, SessionScreen } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, untrack } from "solid-js"
import { errorMessage, type Forks } from "./forks"

type Data = SessionRef["server"]["data"]
type Message = ReturnType<Data["session"]["message"]["list"]>[number]
type Assistant = Extract<Message, { type: "assistant" }>
type Part = Assistant["content"][number]
type Tool = Extract<Part, { type: "tool" }>

// The input field a tool call is best summed up by, in order of preference.
const SUMMARY_KEYS = ["description", "command", "path", "filePath", "pattern", "query", "url", "id"]

function toolSummary(tool: Tool): string {
  const input = tool.state.input
  if (typeof input === "string") return ""
  for (const key of SUMMARY_KEYS) {
    const value = input[key]
    if (typeof value === "string" && value) return value.split("\n")[0]
  }
  return ""
}

const answer = (message: Assistant) =>
  message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim()

export function Chat(props: {
  ctx: Context
  forks: Forks
  session: MountedSession
  screen: SessionScreen
  onClose: () => void
}) {
  const { ctx, forks } = props
  const [text, setText] = createSignal("")
  let scroller: HTMLDivElement | undefined
  let input: HTMLTextAreaElement | undefined

  const fork = () => forks.get(props.session.key)
  // The fork's id once it is ready to chat in.
  const id = () => (fork()?.created === undefined ? undefined : fork()?.id)
  const data = () => props.session.server.data

  // A tab restored or opened without the command forks when it shows. Only on a session switch, so the fork a closing
  // tab discards is not made again.
  createEffect(
    on(
      () => props.session.key,
      () => {
        const session = untrack(() => props.session)
        if (!forks.get(session.key)) void forks.start(session)
      },
    ),
  )

  createEffect(
    on(id, (id) => {
      if (!id) return
      void data().session.message.sync(id).catch(() => {})
      void data().session.permission.sync(id).catch(() => {})
      queueMicrotask(() => input?.focus())
    }),
  )

  // The fork carries the main session's history; the side chat shows what was said after it, so nothing until the fork
  // is ready and its creation time known.
  const messages = createMemo(() => {
    const current = fork()
    if (!current?.id || current.created === undefined) return []
    const since = current.created
    return data()
      .session.message.list(current.id)
      .filter((message) => message.time.created >= since && (message.type === "user" || message.type === "assistant"))
  })
  const running = () => {
    const current = id()
    return !!current && data().session.status(current) === "running"
  }
  const permissions = () => {
    const current = id()
    return current ? data().session.permission.list(current) : []
  }

  // Follow the answer while it streams, unless the user scrolled up to read.
  let pinned = true
  const onScroll = () => {
    if (!scroller) return
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
  }
  createEffect(() => {
    const last = messages().at(-1)
    if (last?.type === "assistant") last.content.forEach((part) => part.type !== "tool" && part.text.length)
    permissions().length
    if (pinned) requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }))
  })

  const send = async () => {
    const current = id()
    const value = text().trim()
    if (!current || !value) return
    setText("")
    pinned = true
    try {
      await data().session.prompt({ sessionID: current, text: value })
    } catch (error) {
      setText(value)
      ctx.toast.show({ title: "Side chat", description: errorMessage(error), variant: "error" })
    }
  }

  const stop = () => {
    const current = id()
    if (current) void props.session.server.client.session.interrupt({ sessionID: current }).catch(() => {})
  }

  const reply = (requestID: string, decision: "once" | "reject") => {
    const current = id()
    if (current) void data().session.permission.reply({ sessionID: current, requestID, decision }).catch(() => {})
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
    event.preventDefault()
    void send()
  }

  return (
    <div class="sc-root">
      <div class="sc-toolbar">
        <ctx.ui.Icon name="speech-bubble" size="small" class="sc-muted" />
        <span class="sc-title">Side chat</span>
        <span class="sc-muted sc-subtitle">Read-only fork · deleted on close</span>
        <span class="sc-spacer" />
        <ctx.ui.Tooltip value="Start over from the main session's latest state">
          <ctx.ui.IconButton
            icon="refresh"
            label="Start over"
            variant="ghost-muted"
            size="small"
            disabled={!fork() || (!id() && !fork()?.error)}
            onClick={() => void forks.restart(props.session)}
          />
        </ctx.ui.Tooltip>
        <ctx.ui.Tooltip value="Close and delete the side chat">
          <ctx.ui.IconButton icon="close" label="Close" variant="ghost-muted" size="small" onClick={props.onClose} />
        </ctx.ui.Tooltip>
      </div>

      <div class="sc-scroll" ref={scroller} onScroll={onScroll}>
        <Switch>
          <Match when={fork()?.error}>
            {(error) => (
              <div class="sc-empty">
                <span class="sc-error">Could not fork the session: {error()}</span>
                <ctx.ui.Button size="small" onClick={() => void forks.start(props.session)}>
                  Try again
                </ctx.ui.Button>
              </div>
            )}
          </Match>
          <Match when={!id()}>
            <div class="sc-empty">
              <ctx.ui.Loader size="small" />
              <span class="sc-muted">Forking the session…</span>
            </div>
          </Match>
          <Match when={messages().length === 0}>
            <div class="sc-empty sc-muted">
              Ask a side question. This chat sees everything in the main session up to now, can read and run things but
              not edit files, and is deleted when you close it.
            </div>
          </Match>
        </Switch>

        <For each={messages()}>
          {(message) => (
            <Switch>
              <Match when={message.type === "user" && message}>
                {(user) => <div class="sc-user">{user().text}</div>}
              </Match>
              <Match when={message.type === "assistant" && message}>
                {(assistant) => (
                  <div class="sc-assistant">
                    <For each={assistant().content}>
                      {(part) => (
                        <Switch>
                          <Match when={part.type === "text" && part}>
                            {(part) => <ctx.ui.Markdown text={part().text} class="sc-markdown" />}
                          </Match>
                          <Match when={part.type === "reasoning" && part.text.trim() ? part : undefined}>
                            {(part) => (
                              <details class="sc-reasoning">
                                <summary>Thinking</summary>
                                <div>{part().text}</div>
                              </details>
                            )}
                          </Match>
                          <Match when={part.type === "tool" && part}>
                            {(tool) => (
                              <div class="sc-tool" data-status={tool().state.status}>
                                <Show
                                  when={tool().state.status === "running" || tool().state.status === "streaming"}
                                  fallback={
                                    <ctx.ui.Icon
                                      name={tool().state.status === "error" ? "close-small" : "check-small"}
                                      size="small"
                                    />
                                  }
                                >
                                  <ctx.ui.Loader size="small" />
                                </Show>
                                <span class="sc-tool-name">{tool().name}</span>
                                <span class="sc-tool-summary">{toolSummary(tool())}</span>
                              </div>
                            )}
                          </Match>
                        </Switch>
                      )}
                    </For>
                    <Show when={assistant().error}>{(error) => <div class="sc-error">{error().message}</div>}</Show>
                    <Show when={assistant().time.completed ? answer(assistant()) : ""}>
                      {(text) => (
                        <div class="sc-actions">
                          <ctx.ui.Tooltip value="Copy">
                            <ctx.ui.IconButton
                              icon="copy"
                              label="Copy"
                              variant="ghost-muted"
                              size="small"
                              onClick={() => void ctx.system.copy(text())}
                            />
                          </ctx.ui.Tooltip>
                          <ctx.ui.Tooltip value="Add to the main session's prompt">
                            <ctx.ui.IconButton
                              icon="outline-quote"
                              label="Add to the main prompt"
                              variant="ghost-muted"
                              size="small"
                              onClick={() => props.screen.composer.insert(text())}
                            />
                          </ctx.ui.Tooltip>
                        </div>
                      )}
                    </Show>
                  </div>
                )}
              </Match>
            </Switch>
          )}
        </For>

        <For each={permissions()}>
          {(request) => (
            <div class="sc-permission">
              <div>
                <span class="sc-permission-action">{request.action}</span>{" "}
                <span class="sc-muted">{request.message ?? request.resources.join(", ")}</span>
              </div>
              <div class="sc-permission-buttons">
                <ctx.ui.Button size="small" variant="contrast" onClick={() => reply(request.id, "once")}>
                  Allow once
                </ctx.ui.Button>
                <ctx.ui.Button size="small" variant="ghost" onClick={() => reply(request.id, "reject")}>
                  Reject
                </ctx.ui.Button>
              </div>
            </div>
          )}
        </For>

        <Show when={running() && permissions().length === 0}>
          <div class="sc-working">
            <ctx.ui.Loader size="small" />
          </div>
        </Show>
      </div>

      <div class="sc-composer">
        <textarea
          ref={input}
          rows={2}
          placeholder={id() ? "Ask about this session…" : "Waiting for the fork…"}
          disabled={!id()}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <Show
          when={running()}
          fallback={
            <ctx.ui.IconButton
              icon="arrow-up"
              label="Send"
              size="small"
              disabled={!id() || !text().trim()}
              onClick={() => void send()}
            />
          }
        >
          <ctx.ui.IconButton icon="stop" label="Stop" size="small" onClick={stop} />
        </Show>
      </div>
    </div>
  )
}
