import type { Context } from "@opencode/plugin/gui"
import { createLatest } from "@opencode/plugin/gui"
import { createSignal, For, Show } from "solid-js"
import type { LimitProvider, LimitReset, LimitsResult } from "../types"
import { errorMessage, loadLimits, redeemReset } from "./api"
import { ago, percent, until } from "./format"

export function LimitsView(props: { ctx: Context; directory: () => string | undefined }) {
  const ui = props.ctx.ui
  const [version, setVersion] = createSignal(0)
  /** Set by the refresh button and taken by the next load, so only that load bypasses the cache. */
  let force = false

  const limits = createLatest(
    () => JSON.stringify({ directory: props.directory(), v: version() }),
    (key, signal) => {
      const { directory } = JSON.parse(key) as { directory?: string }
      const refresh = force
      force = false
      return loadLimits(props.ctx, { directory, refresh }, signal)
    },
  )

  /** The result a redeem returned; it shows until the next load. */
  const [redeemed, setRedeemed] = createSignal<LimitsResult>()
  const [busy, setBusy] = createSignal(false)
  const data = () => redeemed() ?? limits.latest

  const redeem = async (provider: LimitProvider, reset: LimitReset) => {
    if (busy()) return
    const ok = await props.ctx.dialogs.confirm({
      title: `Use this ${provider.label} reset now?`,
      description: "It refreshes your 5-hour and weekly Codex limits and can't be undone.",
      confirm: "Use reset",
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      setRedeemed(await redeemReset(props.ctx, { provider: "codex", creditId: reset.id, directory: props.directory() }))
      props.ctx.toast.show({ title: "Codex reset used", description: "Your 5-hour and weekly limits were refreshed.", variant: "success" })
    } catch (error) {
      props.ctx.toast.show({ title: "Could not use the reset", description: errorMessage(error), variant: "error" })
    } finally {
      setBusy(false)
    }
  }
  const refresh = () => {
    force = true
    setRedeemed(undefined)
    setVersion((v) => v + 1)
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
                {(provider) => <ProviderCard ctx={props.ctx} provider={provider} busy={busy()} onRedeem={(reset) => redeem(provider, reset)} />}
              </For>
              <div class="uv-footnote">
                Limits are reported by the providers themselves (Claude Code, Codex and OpenCode Go), not estimated from local sessions. API-key
                accounts have no subscription limits.
              </div>
            </section>
          </div>
        )}
      </Show>
    </div>
  )
}

function ProviderCard(props: { ctx: Context; provider: LimitProvider; busy: boolean; onRedeem: (reset: LimitReset) => void }) {
  const ui = props.ctx.ui
  const resets = () => props.provider.resets ?? []
  return (
    <div class="uv-limit-provider">
      <div class="uv-limit-head">
        <span class="uv-strong">{props.provider.label}</span>
        <Show when={props.provider.account}>
          {(account) => <span class="uv-pill">{account()}</span>}
        </Show>
        <Show when={resets().length === 0 ? props.provider.resetCredits : undefined}>
          {(credits) => (
            <span class="uv-pill" title="Banked rate-limit reset credits reported by Codex">
              {credits()} reset {credits() === 1 ? "credit" : "credits"}
            </span>
          )}
        </Show>
        <span class="uv-spacer" />
        <Show when={props.provider.manageUrl}>
          {(url) => (
            <ui.Button size="small" variant="ghost" onClick={() => props.ctx.system.openExternal(url())}>
              {MANAGE_LABELS[props.provider.id]}
            </ui.Button>
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
      <Show when={resets().length > 0}>
        <div class="uv-resets">
          <div class="uv-muted uv-small">Banked resets</div>
          <For each={resets()}>
            {(reset) => (
              <div class="uv-reset-row">
                <div class="uv-reset-info">
                  <span class="uv-ellipsis">{reset.title ?? "Limit reset"}</span>
                  <span class="uv-muted uv-small">
                    {reset.status !== "available" ? `${reset.status} · ` : ""}
                    {reset.expiresAt ? `expires ${until(reset.expiresAt)} (${new Date(reset.expiresAt).toLocaleDateString()})` : "no expiry reported"}
                  </span>
                </div>
                <Show when={reset.status === "available" && props.provider.id === "codex"}>
                  <ui.Button size="small" variant="neutral" disabled={props.busy} onClick={() => props.onRedeem(reset)}>
                    Use reset
                  </ui.Button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

const MANAGE_LABELS: Record<LimitProvider["id"], string> = {
  claude: "Manage on claude.ai",
  codex: "Manage on ChatGPT",
  opencode: "Open Console",
}
