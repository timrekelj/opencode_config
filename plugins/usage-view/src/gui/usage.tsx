import { createLatest, type Context, type MountedSession } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { modelKey, type Price } from "../types"
import { errorMessage, loadUsage, RANGES, type Bucket, type RangeId, type Scope, type SessionInfo, type Stats, type UsageData } from "./api"
import { LimitsView } from "./limits"
import {
  ago,
  cacheSavings,
  costParts,
  dollars,
  duration,
  emptyParts,
  estimate,
  exact,
  percent,
  tokens,
  totalTokens,
  type CostParts,
  type Tokens,
} from "./format"

export type Metric = "cost" | "tokens"
export type View = "usage" | "limits"

export interface Prefs {
  view: View
  range: RangeId
  scope: Scope
  metric: Metric
}

export interface UsageViewProps {
  ctx: Context
  prefs: Prefs
  setPrefs: (patch: Partial<Prefs>) => void
  /** The session the view belongs to; read reactively. */
  session: () => MountedSession | undefined
  variant: "panel" | "page"
}

const TOOL_LIMIT = 12
const SESSION_LIMIT = 10

interface Costed {
  /** Sum of the estimates that have a price. */
  est: number
  /** The estimate split by token type. */
  parts: CostParts
  /** What cache reads saved against the full input price. */
  savings: number
  /** Some tokens had no known price. */
  partial: boolean
  /** No tokens had a known price. */
  unknown: boolean
}

function costOf(models: Stats["models"], prices: Record<string, Price | null>): Costed {
  let est = 0
  let savings = 0
  const parts = emptyParts()
  let priced = 0
  let unpriced = 0
  for (const m of models) {
    const price = prices[modelKey(m.model)]
    const split = costParts(m.tokens, price)
    const size = totalTokens(m.tokens)
    if (split === undefined) {
      if (size > 0) unpriced++
    } else {
      parts.input += split.input
      parts.cacheRead += split.cacheRead
      parts.cacheWrite += split.cacheWrite
      parts.output += split.output
      est += split.input + split.cacheRead + split.cacheWrite + split.output
      savings += cacheSavings(m.tokens, price)
      priced++
    }
  }
  return { est, parts, savings, partial: unpriced > 0 && priced > 0, unknown: unpriced > 0 && priced === 0 }
}

const costLabel = (c: Costed) => (c.unknown ? "—" : `${c.partial ? "≥" : ""}${dollars(c.est)}`)

function Segmented<T extends string>(props: {
  label: string
  value: T
  options: { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div class="uv-segmented" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.value}
            classList={{ "uv-segment": true, "uv-segment-active": props.value === option.value }}
            disabled={option.disabled}
            title={option.title}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

function Card(props: { label: string; value: JSX.Element; title?: string; sub?: JSX.Element; class?: string }) {
  return (
    <div class={`uv-card ${props.class ?? ""}`} title={props.title}>
      <div class="uv-card-label">{props.label}</div>
      <div class="uv-card-value">{props.value}</div>
      <Show when={props.sub}>
        <div class="uv-card-sub">{props.sub}</div>
      </Show>
    </div>
  )
}

export function UsageView(props: UsageViewProps) {
  const ui = props.ctx.ui
  const [version, setVersion] = createSignal(0)
  const [showAllTools, setShowAllTools] = createSignal(false)

  const projectID = () => props.session()?.project?.id
  const directory = () => props.session()?.directory
  const scope = (): Scope => (props.prefs.scope === "project" && projectID() ? "project" : "all")

  const usage = createLatest(
    () => JSON.stringify({ range: props.prefs.range, project: scope() === "project" ? projectID() : undefined, directory: directory(), v: version() }),
    (key, signal) => {
      const { range, project, directory } = JSON.parse(key) as { range: RangeId; project?: string; directory?: string }
      return loadUsage(props.ctx, { range, project, directory }, signal)
    },
  )

  const data = () => usage.latest
  const prices = () => data()?.prices ?? {}
  const total = createMemo(() => {
    const d = data()
    return d ? costOf(d.totals.models, d.prices) : undefined
  })

  const projectName = () => {
    const session = props.session()
    const project = session?.listedProject?.name ?? session?.project?.name
    if (project) return project
    const dir = session?.project?.worktree ?? session?.directory
    return dir ? dir.split("/").filter(Boolean).at(-1) : undefined
  }

  return (
    <div class={`uv-root uv-${props.variant}`}>
      <div class="uv-toolbar">
        <Segmented
          label="View"
          value={props.prefs.view}
          options={[
            { value: "usage", label: "Usage" },
            { value: "limits", label: "Limits" },
          ]}
          onChange={(view) => props.setPrefs({ view })}
        />
        <Show when={props.prefs.view === "usage"}>
          <Segmented
            label="Range"
          value={props.prefs.range}
          options={RANGES.map((r) => ({ value: r.value, label: r.short, title: r.label }))}
          onChange={(range) => props.setPrefs({ range })}
        />
        <Segmented
          label="Scope"
          value={scope()}
          options={[
            {
              value: "project",
              label: "Project",
              disabled: !projectID(),
              title: projectID() ? `This project${projectName() ? `: ${projectName()}` : ""}` : "Open a session to filter by its project",
            },
            { value: "all", label: "All projects", title: "All projects" },
          ]}
          onChange={(scope) => props.setPrefs({ scope })}
        />
        </Show>
        <span class="uv-spacer" />
        <Show when={props.prefs.view === "usage"}>
          <ui.Tooltip value="Refresh">
            <ui.IconButton
              icon="refresh"
              label="Refresh"
              variant="ghost"
              size="small"
              busy={usage.loading}
              onClick={() => setVersion((v) => v + 1)}
            />
          </ui.Tooltip>
        </Show>
      </div>

      <Show when={props.prefs.view === "limits"}>
        <LimitsView ctx={props.ctx} directory={directory} />
      </Show>
      <Show when={props.prefs.view === "usage"}>
      <div class="uv-scroll">
        <Show when={usage.error}>
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
        <Show when={!usage.error && !data()}>
          <div class="uv-empty">
            <ui.Loader size="large" />
          </div>
        </Show>
        <Show when={!usage.error && data()}>
          {(d) => (
            <div classList={{ "uv-content": true, "uv-stale": usage.loading }}>
              <Show when={d().pricesError}>
                {(message) => (
                  <div class="uv-notice uv-notice-warning">
                    <ui.Icon name="warning" size="small" />
                    <span>Prices unavailable: {message()}</span>
                  </div>
                )}
              </Show>
              <Show when={d().retainedError}>
                {(message) => (
                  <div class="uv-notice uv-notice-warning">
                    <ui.Icon name="warning" size="small" />
                    <span>Usage of deleted sessions unavailable: {message()}</span>
                  </div>
                )}
              </Show>
              <Summary data={d()} cost={total()!} />
              <Chart ui={ui} data={d()} prices={prices()} metric={props.prefs.metric} setMetric={(metric) => props.setPrefs({ metric })} />
              <div class="uv-columns">
                <Models data={d()} cost={total()!} />
                <Tools ui={ui} data={d()} showAll={showAllTools()} toggle={() => setShowAllTools((v) => !v)} />
              </div>
              <Sessions ctx={props.ctx} data={d()} prices={prices()} />
              <div class="uv-footnote">
                Estimated cost uses public API list prices from models.dev and counts reasoning tokens as output. It is what
                this usage would cost on pay-as-you-go API billing, not what you were charged.
              </div>
            </div>
          )}
        </Show>
      </div>
      </Show>
    </div>
  )
}

function Summary(props: { data: UsageData; cost: Costed }) {
  const t = () => props.data.totals
  const all = () => totalTokens(t().tokens)
  const cacheShare = () => (all() > 0 ? t().tokens.cache.read / all() : 0)
  return (
    <div class="uv-cards">
      <Card
        class="uv-card-hero"
        label="Est. API cost"
        value={costLabel(props.cost)}
        title={props.cost.partial ? "Some models have no known price; the estimate covers the rest." : undefined}
        sub={
          <span>
            <Show when={t().cost > 0} fallback={<span>Billed {dollars(t().cost)}</span>}>
              <span class="uv-strong-muted">Billed {dollars(t().cost)}</span>
            </Show>
            <Show when={props.cost.est > 0}>
              <CostTypes parts={props.cost.parts} total={props.cost.est} />
            </Show>
          </span>
        }
      />
      <Card
        label="Cache savings"
        value={props.cost.unknown ? "—" : dollars(props.cost.savings)}
        title="Cache reads priced at the full input rate, minus what they cost at the cache read rate"
        sub={<span>{percent(cacheShare())} of tokens were cache reads</span>}
      />
      <Card
        label="Tokens"
        value={tokens(all())}
        title={`${exact(all())} tokens`}
        sub={
          <span class="uv-breakdown">
            <span title={`${exact(t().tokens.input)} input`}>in {tokens(t().tokens.input)}</span>
            <span title={`${exact(t().tokens.output + t().tokens.reasoning)} output (incl. ${exact(t().tokens.reasoning)} reasoning)`}>
              out {tokens(t().tokens.output + t().tokens.reasoning)}
            </span>
            <span title={`${exact(t().tokens.cache.read)} cache read · ${percent(cacheShare())} of all tokens`}>
              cache r {tokens(t().tokens.cache.read)}
            </span>
            <span title={`${exact(t().tokens.cache.write)} cache write`}>cache w {tokens(t().tokens.cache.write)}</span>
          </span>
        }
      />
      <Card
        label="Sessions"
        value={exact(t().sessions)}
        sub={
          <span>
            {exact(t().prompts)} prompts · {exact(t().steps)} steps
            <Show when={t().subagents > 0}> · {exact(t().subagents)} subagents</Show>
            <Show when={props.data.retained}>
              {(r) => (
                <span title="Usage kept from sessions that were deleted. Prompts and tools are not kept.">
                  {" "}
                  · incl. {exact(r().sessions)} deleted
                </span>
              )}
            </Show>
          </span>
        }
      />
      <Card
        label="Active days"
        value={exact(t().activeDays)}
        sub={<span>Streak {exact(t().streak)} {t().streak === 1 ? "day" : "days"}</span>}
      />
    </div>
  )
}

const COST_TYPES: { key: keyof CostParts; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "output", label: "Output" },
]

function CostTypes(props: { parts: CostParts; total: number }) {
  return (
    <span class="uv-types">
      <span class="uv-types-bar" aria-hidden="true">
        <For each={COST_TYPES}>
          {(type) => (
            <span class={`uv-type-${type.key}`} style={{ width: `${(props.parts[type.key] / props.total) * 100}%` }} />
          )}
        </For>
      </span>
      <span class="uv-breakdown">
        <For each={COST_TYPES}>
          {(type) => (
            <span title={`${percent(props.parts[type.key] / props.total)} of est. cost`}>
              <span class={`uv-type-dot uv-type-${type.key}`} />
              {type.label} {dollars(props.parts[type.key])}
            </span>
          )}
        </For>
      </span>
    </span>
  )
}

/** Catmull-Rom spline through the points, as an SVG path in a 0–100 viewBox. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ""
  const f = (n: number) => n.toFixed(2)
  if (pts.length === 1) return `M ${f(pts[0]!.x)} ${f(pts[0]!.y)}`
  let d = `M ${f(pts[0]!.x)} ${f(pts[0]!.y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    d += ` C ${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)}, ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)}, ${f(p2.x)} ${f(p2.y)}`
  }
  return d
}

function Chart(props: {
  ui: Context["ui"]
  data: UsageData
  prices: Record<string, Price | null>
  metric: "cost" | "tokens"
  setMetric: (metric: "cost" | "tokens") => void
}) {
  const entries = createMemo(() =>
    props.data.buckets.map((bucket: Bucket, index, all) => {
      const stats = bucket.stats
      const cost = stats ? costOf(stats.models, props.prices) : { est: 0, parts: emptyParts(), savings: 0, partial: false, unknown: false }
      const size = stats ? totalTokens(stats.tokens) : 0
      return {
        bucket,
        cost,
        tokens: size,
        steps: stats?.steps ?? 0,
        value: props.metric === "cost" ? cost.est : size,
        i: index,
        x: all.length > 1 ? (index / (all.length - 1)) * 100 : 50,
      }
    }),
  )
  const max = createMemo(() => Math.max(0, ...entries().map((b) => b.value)))
  /** Y axis in round steps that cover the max, e.g. $0/$50/$100/$150. */
  const axis = createMemo(() => {
    const m = max()
    if (m <= 0) return { top: 0, ticks: [{ value: 0, y: 100 }] }
    const count = 3
    const raw = m / count
    const mag = 10 ** Math.floor(Math.log10(raw))
    const norm = raw / mag
    const tickStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
    const top = tickStep * count
    return { top, ticks: Array.from({ length: count + 1 }, (_, i) => ({ value: top - i * tickStep, y: (i / count) * 100 })) }
  })
  /** Buckets with stats, with y as a percentage of the plot height (0 = top). Future buckets are left out. */
  const points = createMemo(() => {
    const top = axis().top
    return entries()
      .filter((b) => b.bucket.stats)
      .map((b) => ({ ...b, y: top > 0 && b.value > 0 ? 100 - (b.value / top) * 100 : 100 }))
  })
  const labelStep = createMemo(() => Math.max(1, Math.ceil(entries().length / 3)))
  const peak = () => (props.metric === "cost" ? dollars(max()) : tokens(max()))
  const grid = createMemo(() =>
    axis().ticks.map((t) => ({
      y: t.y,
      label: t.value === 0 ? "0" : props.metric === "cost" ? dollars(t.value) : tokens(t.value),
    })),
  )
  const line = createMemo(() => smoothPath(points().map((p) => ({ x: p.x, y: p.y }))))
  const area = createMemo(() => {
    const pts = points()
    if (pts.length === 0) return ""
    return `${line()} L ${pts[pts.length - 1]!.x.toFixed(2)} 100 L ${pts[0]!.x.toFixed(2)} 100 Z`
  })
  const hitWidth = () => (entries().length > 0 ? 100 / entries().length : 100)

  return (
    <section class="uv-section">
      <div class="uv-section-head">
        <span class="uv-section-title">Over time</span>
        <span class="uv-muted uv-small">peak {peak()}</span>
        <span class="uv-spacer" />
        <Segmented
          label="Chart metric"
          value={props.metric}
          options={[
            { value: "cost", label: "Cost" },
            { value: "tokens", label: "Tokens" },
          ]}
          onChange={props.setMetric}
        />
      </div>
      <div class="uv-chart">
        <div class="uv-ylabels">
          <For each={grid()}>
            {(g) => (
              <span class="uv-ylabel" style={{ top: `${g.y}%` }}>
                {g.label}
              </span>
            )}
          </For>
        </div>
        <div class="uv-plot">
          <svg class="uv-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="uv-line-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" class="uv-stop-top" />
                <stop offset="100%" class="uv-stop-bottom" />
              </linearGradient>
            </defs>
            <For each={grid()}>
              {(g) => <line class="uv-gridline" x1="0" x2="100" y1={g.y} y2={g.y} vector-effect="non-scaling-stroke" />}
            </For>
            <path class="uv-area" d={area()} />
            <path class="uv-line" d={line()} vector-effect="non-scaling-stroke" />
          </svg>
          <div class="uv-hits" role="list">
            <For each={points()}>
              {(p) => (
                <props.ui.Tooltip
                  value={
                    <span class="uv-tip">
                      <strong>{p.bucket.label}</strong>
                      <span>
                        {costLabel(p.cost)} est. · {tokens(p.tokens)} tokens · {exact(p.steps)} steps
                      </span>
                    </span>
                  }
                >
                  <div
                    class="uv-hit"
                    role="listitem"
                    style={{ left: `${(p.i / entries().length) * 100}%`, width: `${hitWidth()}%` }}
                    aria-label={`${p.bucket.label}: ${costLabel(p.cost)}, ${tokens(p.tokens)} tokens`}
                  >
                    <span
                      class="uv-dot"
                      style={{ left: `${((p.x - (p.i / entries().length) * 100) / hitWidth()) * 100}%`, top: `${p.y}%` }}
                    />
                  </div>
                </props.ui.Tooltip>
              )}
            </For>
          </div>
        </div>
        <div class="uv-xlabels">
          <For each={entries()}>
            {(entry, index) => (
              <span
                class="uv-xlabel"
                style={{
                  left: `${entry.x}%`,
                  transform:
                    entries().length > 1 && index() === entries().length - 1
                      ? "translateX(-100%)"
                      : entries().length > 1 && index() === 0
                        ? "none"
                        : "translateX(-50%)",
                }}
              >
                {index() % labelStep() === 0 || index() === entries().length - 1 ? entry.bucket.short : ""}
              </span>
            )}
          </For>
        </div>
      </div>
    </section>
  )
}

function Models(props: { data: UsageData; cost: Costed }) {
  const rows = createMemo(() => {
    const all = totalTokens(props.data.totals.tokens)
    const useCost = props.cost.est > 0
    return props.data.totals.models
      .map((m) => {
        const est = estimate(m.tokens, props.data.prices[modelKey(m.model)])
        const size = totalTokens(m.tokens)
        return {
          model: m.model,
          steps: m.steps,
          tokens: size,
          tokenDetail: m.tokens as Tokens,
          est,
          billed: m.cost,
          share: useCost ? (est ?? 0) / props.cost.est : all > 0 ? size / all : 0,
        }
      })
      .sort((a, b) => (b.est ?? -1) - (a.est ?? -1) || b.tokens - a.tokens)
  })
  return (
    <section class="uv-section">
      <div class="uv-section-head">
        <span class="uv-section-title">By model</span>
        <span class="uv-muted uv-small">share of {props.cost.est > 0 ? "est. cost" : "tokens"}</span>
      </div>
      <Show when={rows().length > 0} fallback={<div class="uv-none">No model usage in this range.</div>}>
        <table class="uv-table">
          <thead>
            <tr>
              <th>Model</th>
              <th class="uv-num uv-hide-narrow">Steps</th>
              <th class="uv-num">Tokens</th>
              <th class="uv-num">Est. cost</th>
              <th class="uv-num uv-share-col">Share</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row) => (
                <tr>
                  <td class="uv-model">
                    <span class="uv-ellipsis" title={`${row.model.providerID}/${row.model.id}${row.model.variant ? ` (${row.model.variant})` : ""}`}>
                      {row.model.id}
                    </span>
                    <span class="uv-muted uv-small uv-ellipsis">
                      {row.model.providerID}
                      <Show when={row.model.variant && row.model.variant !== "default"}> · {row.model.variant}</Show>
                    </span>
                  </td>
                  <td class="uv-num uv-hide-narrow">{exact(row.steps)}</td>
                  <td
                    class="uv-num"
                    title={`in ${exact(row.tokenDetail.input)} · out ${exact(row.tokenDetail.output + row.tokenDetail.reasoning)} · cache read ${exact(row.tokenDetail.cache.read)} · cache write ${exact(row.tokenDetail.cache.write)}`}
                  >
                    {tokens(row.tokens)}
                  </td>
                  <td class="uv-num" title={row.billed > 0 ? `Billed ${dollars(row.billed)}` : row.est === undefined ? "No known price" : undefined}>
                    {dollars(row.est)}
                  </td>
                  <td class="uv-num uv-share-col">
                    <span class="uv-share">
                      <span class="uv-share-bar">
                        <span style={{ width: `${Math.min(100, row.share * 100)}%` }} />
                      </span>
                      <span>{percent(row.share)}</span>
                    </span>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  )
}

function Tools(props: { ui: Context["ui"]; data: UsageData; showAll: boolean; toggle: () => void }) {
  const tools = () => props.data.totals.tools
  const usage = () => {
    const t = tools()
    return t.mode === "detail" ? [...t.usage].sort((a, b) => b.calls - a.calls) : []
  }
  const visible = () => (props.showAll ? usage() : usage().slice(0, TOOL_LIMIT))
  const totals = () => {
    const t = tools()
    return t.mode === "none" ? undefined : t.totals
  }
  return (
    <section class="uv-section">
      <div class="uv-section-head">
        <span class="uv-section-title">Tools</span>
        <Show when={totals()}>
          {(t) => (
            <span class="uv-muted uv-small">
              {exact(t().calls)} calls · {percent(t().calls > 0 ? t().failed / t().calls : 0)} failed
            </span>
          )}
        </Show>
      </div>
      <Show when={usage().length > 0} fallback={<div class="uv-none">No tool calls in this range.</div>}>
        <table class="uv-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th class="uv-num">Calls</th>
              <th class="uv-num">Failed</th>
              <th class="uv-num">p50</th>
            </tr>
          </thead>
          <tbody>
            <For each={visible()}>
              {(tool) => {
                const rate = () => (tool.calls > 0 ? tool.failed / tool.calls : 0)
                return (
                  <tr>
                    <td class="uv-mono uv-ellipsis" title={tool.name}>
                      {tool.name}
                    </td>
                    <td class="uv-num" title={`${exact(tool.succeeded)} succeeded · ${exact(tool.failed)} failed · ${exact(tool.unfinished)} unfinished`}>
                      {exact(tool.calls)}
                    </td>
                    <td classList={{ "uv-num": true, "uv-bad": rate() >= 0.1, "uv-warn": rate() > 0 && rate() < 0.1 }}>
                      {tool.failed > 0 ? percent(rate()) : "–"}
                    </td>
                    <td class="uv-num">{duration(tool.durationP50)}</td>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
        <Show when={usage().length > TOOL_LIMIT}>
          <button type="button" class="uv-more" onClick={props.toggle}>
            {props.showAll ? "Show fewer" : `Show all ${usage().length}`}
          </button>
        </Show>
      </Show>
    </section>
  )
}

function Sessions(props: { ctx: Context; data: UsageData; prices: Record<string, Price | null> }) {
  const rows = () => props.data.sessions.slice(0, SESSION_LIMIT)
  const open = (session: SessionInfo) => props.ctx.tabs.open({ server: "sidecar", id: session.id }, { focus: true })
  const folder = (dir: string) => dir.split("/").filter(Boolean).at(-1) ?? dir
  return (
    <section class="uv-section">
      <div class="uv-section-head">
        <span class="uv-section-title">Top sessions</span>
        <span class="uv-muted uv-small" title="Lifetime totals of sessions active in this range; cost uses each session's current model.">
          lifetime totals · cost ≈
        </span>
      </div>
      <Show when={rows().length > 0} fallback={<div class="uv-none">No sessions in this range.</div>}>
        <div class="uv-sessions">
          <For each={rows()}>
            {(session) => {
              const est = () => (session.model ? estimate(session.tokens, props.prices[modelKey(session.model)]) : undefined)
              return (
                <button type="button" class="uv-session" onClick={() => open(session)} title={session.title ?? session.id}>
                  <span class="uv-session-main">
                    <span class="uv-session-title">
                      <Show when={session.parentID}>
                        <span class="uv-pill">subagent</span>
                      </Show>
                      <span class="uv-ellipsis">{session.title || "Untitled session"}</span>
                    </span>
                    <span class="uv-session-meta uv-muted uv-small">
                      <span class="uv-ellipsis">{folder(session.location.directory)}</span>
                      <Show when={session.model}>
                        {(model) => (
                          <>
                            <span>·</span>
                            <span class="uv-ellipsis uv-hide-narrow">{model().id}</span>
                          </>
                        )}
                      </Show>
                      <span>·</span>
                      <span class="uv-nowrap">{ago(session.time.updated)}</span>
                    </span>
                  </span>
                  <span class="uv-session-nums">
                    <span class="uv-strong" title={est() === undefined ? "No known price" : "Approximate: priced at the session's current model"}>
                      {est() === undefined ? "—" : `≈${dollars(est())}`}
                    </span>
                    <span class="uv-muted uv-small" title={`${exact(totalTokens(session.tokens))} tokens`}>
                      {tokens(totalTokens(session.tokens))}
                    </span>
                  </span>
                </button>
              )
            }}
          </For>
        </div>
        <Show when={props.data.sessionsTruncated}>
          <div class="uv-none">Only the most recently active sessions were scanned.</div>
        </Show>
      </Show>
    </section>
  )
}
