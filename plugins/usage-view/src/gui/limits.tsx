import type { Context } from "@opencode/plugin/gui"
import { createLatest } from "@opencode/plugin/gui"
import { createSignal, For, Show } from "solid-js"
import type { LimitProvider, LimitsResult } from "../types"
import { errorMessage, loadLimits } from "./api"
import { ago, percent, until } from "./format"

export function LimitsView(props: { ctx: Context; directory: () => string | undefined }) {
  const ui = props.ctx.ui
  const [version, setVersion] = createSignal(0)
  const [refreshing, setRefreshing] = createSignal(false)

  const limits = createLatest(
    () => JSON.stringify({ directory: props.directory(), v: version() }),
    (key, signal) => {
      const { directory } = JSON.parse(key) as { directory?: string }
      return loadLimits(props.ctx, { directory, refresh: refreshing() }, signal)
    },
  )

  const data = () => limits.latest
  const refresh = () => {
    setRefreshing(true)
    setVersion((v) => v + 1)
    setRefreshing(false)
  }

  return (
    <div class="uv-scroll">
      <Show when={limits.error}>
        {(error) => (
          <div class="uv-empty uv-error">
            <ui.Icon name="circle-exclamation" />
            <span>{errorMessage(error())}</span>
            <ui.Button size="small" variant="ghost" onClick={() => setVersion((v) => v + 1)}>
              Try again
            </ui.Button>
          </div>
        )}
      </Show>
      <Show when={!limits.error && !data()}>
        <div class="uv-empty">
          <ui.Loader size="large" />
        </div>
      </Show>
      <Show when={!limits.error && data()}>
        {(d) => (
          <div classList={{ "uv-content": true, "uv-stale": limits.loading }}>
            <section class="uv-section">
              <div class="uv-section-head">
                <span class="uv-section-title">Subscription limits</span>
                <span class="uv-muted uv-small">checked {ago(d().checkedAt)}</span>
                <span class="uv-spacer" />
                <ui.Tooltip value="Re-check providers">
                  <ui.IconButton
                    icon="refresh"
                    label="Refresh limits"
                    variant="ghost"
                    size="small"
                    busy={limits.loading}
                    onClick={refresh}
                  />
                </ui.Tooltip>
              </div>
              <For each={d().providers}>
                {(provider) => <ProviderCard provider={provider} />}
              </For>
              <div class="uv-footnote">
                Limits are reported by the providers themselves (Claude Code and Codex), not estimated from local sessions. API-key
                accounts have no subscription limits.
              </div>
            </section>
          </div>
        )}
      </Show>
    </div>
  )
}

function ProviderCard(props: { provider: LimitProvider }) {
  return (
    <div class="uv-limit-provider">
      <div class="uv-limit-head">
        <span class="uv-strong">{props.provider.label}</span>
        <Show when={props.provider.account}>
          {(account) => <span class="uv-pill">{account()}</span>}
        </Show>
        <Show when={props.provider.resetCredits}>
          {(credits) => (
            <span class="uv-pill" title="Banked rate-limit reset credits reported by Codex">
              {credits()} reset {credits() === 1 ? "credit" : "credits"}
            </span>
          )}
        </Show>
      </div>
      <Show
        when={!props.provider.error && props.provider.windows.length > 0}
        fallback={
          <div class="uv-none">
            {props.provider.error ?? "No limit windows reported. API-key and proxy accounts usually have none."}
          </div>
        }
      >
        <For each={props.provider.windows}>
          {(window) => {
            const tone = () =>
              window.usedPercent >= 90 ? "uv-bad" : window.usedPercent >= 70 ? "uv-warn" : ""
            return (
              <div class="uv-limit-window">
                <div class="uv-limit-row">
                  <span class="uv-ellipsis">{window.label}</span>
                  <span class={`uv-num uv-nowrap ${tone()}`}>{Math.round(window.usedPercent)}% used</span>
                </div>
                <div class="uv-limit-bar" role="progressbar" aria-valuenow={window.usedPercent} aria-valuemin={0} aria-valuemax={100}>
                  <span
                    classList={{
                      "uv-limit-fill": true,
                      "uv-limit-fill-warn": window.usedPercent >= 70 && window.usedPercent < 90,
                      "uv-limit-fill-bad": window.usedPercent >= 90,
                    }}
                    style={{ width: `${Math.min(100, window.usedPercent)}%` }}
                  />
                </div>
                <div class="uv-muted uv-small">
                  <Show
                    when={window.resetsAt}
                    fallback={<span>{percent(1 - window.usedPercent / 100)} left</span>}
                  >
                    {(resetsAt) => (
                      <span>
                        {percent(1 - window.usedPercent / 100)} left · resets {until(resetsAt())} (
                        {new Date(resetsAt()).toLocaleString()})
                      </span>
                    )}
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </Show>
    </div>
  )
}

export type { LimitsResult }
