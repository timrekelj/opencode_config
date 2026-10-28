import type { Context } from "@opencode/plugin/gui"
import { createSignal, Show } from "solid-js"
import { describeError } from "./classify"

export { describeError } from "./classify"

/** A toast for a failed action, using the friendly title with the hint as the description. */
export function showErrorToast(ctx: Context, action: string, error: unknown, directory?: string) {
  const info = describeError(error, directory)
  ctx.toast.show({
    variant: "error",
    title: `${action} failed: ${info.title}`,
    description: info.kind === "unknown" ? info.raw : info.hint,
    actions: info.command ? [{ label: "Copy fix", run: () => void ctx.system.copy(info.command!) }] : undefined,
  })
}

/** A slim notice for a failed refresh while older data is still shown. */
export function StaleBanner(props: { ctx: Context; error: unknown; directory?: string; onRetry: () => void }) {
  const ui = props.ctx.ui
  const info = () => describeError(props.error, props.directory)
  return (
    <div class="prr-stale" role="status" title={info().raw}>
      <ui.Icon name={info().icon} size="small" />
      <span class="prr-ellipsis">Couldn't refresh: {info().title}. Showing the last loaded data.</span>
      <span class="prr-spacer" />
      <ui.Button size="small" variant="ghost" onClick={props.onRetry}>
        Retry
      </ui.Button>
    </div>
  )
}

export function ErrorState(props: {
  ctx: Context
  error: unknown
  directory?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  const ui = props.ctx.ui
  const info = () => describeError(props.error, props.directory)
  const [details, setDetails] = createSignal(false)

  return (
    <div class="prr-error-state" role="alert">
      <div class={`prr-error-icon prr-error-${info().kind}`}>
        <ui.Icon name={info().icon} size="large" />
      </div>
      <div class="prr-error-title">{info().title}</div>
      <p class="prr-error-hint">{info().hint}</p>

      <Show when={info().command}>
        {(command) => (
          <div class="prr-error-command">
            <code class="prr-mono">{command()}</code>
            <ui.Tooltip value="Copy">
              <ui.IconButton
                icon="copy"
                label="Copy command"
                variant="ghost"
                size="small"
                onClick={() => {
                  void props.ctx.system.copy(command())
                  props.ctx.toast.show({ variant: "success", title: "Copied" })
                }}
              />
            </ui.Tooltip>
          </div>
        )}
      </Show>

      <div class="prr-error-actions">
        <Show when={props.onRetry && info().retry}>
          <ui.Button size="small" variant="contrast" icon="refresh" busy={props.retrying} onClick={() => props.onRetry?.()}>
            Retry
          </ui.Button>
        </Show>
        <Show when={info().link}>
          {(link) => (
            <ui.Button
              size="small"
              icon="square-arrow-top-right"
              onClick={() => props.ctx.system.openExternal(link().url)}
            >
              {link().label}
            </ui.Button>
          )}
        </Show>
        <ui.Button size="small" variant="ghost-muted" onClick={() => setDetails(!details())}>
          {details() ? "Hide details" : "Details"}
        </ui.Button>
      </div>

      <Show when={details()}>
        <div class="prr-error-details">
          <pre class="prr-mono">{info().raw}</pre>
          <ui.IconButton
            icon="copy"
            label="Copy error"
            variant="ghost"
            size="small"
            onClick={() => void props.ctx.system.copy(info().raw)}
          />
        </div>
      </Show>
    </div>
  )
}
