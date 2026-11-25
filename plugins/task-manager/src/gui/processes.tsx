import type { Context } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { ProcessInfo } from "../types"
import { bytes, duration, pct } from "./format"

export type KillRequest = (process: Pick<ProcessInfo, "pid" | "name" | "command">, force: boolean) => void

type SortKey = "pid" | "name" | "cpu" | "memory" | "user" | "elapsed"

const LIMIT = 200

export function Actions(props: { ctx: Context; process: ProcessInfo; onKill: KillRequest }) {
  const ui = props.ctx.ui
  const blocked = "The OpenCode server can't be quit from here"
  return (
    <span class="tm-actions">
      <span title={props.process.self ? blocked : "Quit (SIGTERM)"}>
        <ui.Button size="small" variant="ghost" disabled={props.process.self} onClick={() => props.onKill(props.process, false)}>
          Quit
        </ui.Button>
      </span>
      <span title={props.process.self ? blocked : "Force quit (SIGKILL)"}>
        <ui.Button size="small" variant="ghost" disabled={props.process.self} onClick={() => props.onKill(props.process, true)}>
          Force
        </ui.Button>
      </span>
    </span>
  )
}

function Row(props: { ctx: Context; process: ProcessInfo; depth?: number; onKill: KillRequest }) {
  const p = () => props.process
  return (
    <tr class="tm-tr" title={p().command || p().name}>
      <td class="tm-td-name">
        <span class="tm-name" style={{ "padding-left": `${(props.depth ?? 0) * 14}px` }}>
          <span class="tm-ellipsis">{p().name}</span>
          <Show when={p().self}>
            <span class="tm-badge tm-badge-accent">server</span>
          </Show>
          <Show when={p().opencode && !p().self}>
            <span class="tm-badge tm-badge-oc">OpenCode</span>
          </Show>
        </span>
      </td>
      <td class="tm-num tm-mono">{p().pid}</td>
      <td class={`tm-num tm-mono ${p().cpu >= 90 ? "tm-hot" : ""}`}>{pct(p().cpu, 1)}</td>
      <td class="tm-num tm-mono">{bytes(p().memory)}</td>
      <td class="tm-user tm-small tm-muted">{p().user}</td>
      <td class="tm-num tm-small tm-muted tm-elapsed">{duration(p().elapsed)}</td>
      <td class="tm-td-actions">
        <Actions ctx={props.ctx} process={p()} onKill={props.onKill} />
      </td>
    </tr>
  )
}

function Head(props: { sort?: SortKey; dir?: 1 | -1; onSort?: (key: SortKey) => void }) {
  const col = (key: SortKey, label: string, cls = "") => (
    <th class={`tm-th ${cls}`} classList={{ "tm-th-sort": !!props.onSort }} aria-sort={props.sort === key ? (props.dir === 1 ? "ascending" : "descending") : "none"}>
      <Show when={props.onSort} fallback={label}>
        <button class="tm-th-btn" onClick={() => props.onSort?.(key)}>
          {label}
          <Show when={props.sort === key}>
            <span class="tm-arrow">{props.dir === 1 ? "▲" : "▼"}</span>
          </Show>
        </button>
      </Show>
    </th>
  )
  return (
    <thead>
      <tr>
        {col("name", "Name", "tm-th-name")}
        {col("pid", "PID", "tm-num")}
        {col("cpu", "CPU", "tm-num")}
        {col("memory", "Memory", "tm-num")}
        {col("user", "User")}
        {col("elapsed", "Elapsed", "tm-num tm-elapsed")}
        <th class="tm-th" />
      </tr>
    </thead>
  )
}

export function Processes(props: {
  ctx: Context
  processes: ProcessInfo[] | undefined
  total: number
  error: unknown
  message: string
  onKill: KillRequest
}) {
  const ui = props.ctx.ui
  const [sort, setSort] = createSignal<SortKey>("cpu")
  const [dir, setDir] = createSignal<1 | -1>(-1)
  const [query, setQuery] = createSignal("")
  const [ocOnly, setOcOnly] = createSignal(false)

  const toggle = (key: SortKey) => {
    if (sort() === key) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setSort(key)
      setDir(key === "name" || key === "user" || key === "pid" ? 1 : -1)
    }
  }

  const matches = createMemo(() => {
    const q = query().trim().toLowerCase()
    const key = sort()
    const d = dir()
    const list = (props.processes ?? []).filter(
      (p) =>
        (!ocOnly() || p.opencode) &&
        (!q || p.name.toLowerCase().includes(q) || p.command.toLowerCase().includes(q) || String(p.pid) === q || String(p.pid).startsWith(q)),
    )
    return list.sort((a, b) => {
      const x = a[key]
      const y = b[key]
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)
      return c * d || a.pid - b.pid
    })
  })
  const shown = () => matches().slice(0, LIMIT)

  return (
    <div class="tm-content">
      <div class="tm-filters">
        <input
          class="tm-search"
          type="search"
          placeholder="Search name, command or PID"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          aria-label="Search processes"
        />
        <label class="tm-check tm-small">
          <input type="checkbox" checked={ocOnly()} onChange={(e) => setOcOnly(e.currentTarget.checked)} />
          OpenCode only
        </label>
      </div>
      <Show when={props.error}>
        <div class="tm-empty tm-error">
          <ui.Icon name="circle-exclamation" />
          <span>{props.message}</span>
        </div>
      </Show>
      <Show when={props.processes} fallback={<Show when={!props.error}><div class="tm-empty tm-muted">Loading…</div></Show>}>
        <div class="tm-table-wrap">
          <table class="tm-table">
            <Head sort={sort()} dir={dir()} onSort={toggle} />
            <tbody>
              <For each={shown()}>{(p) => <Row ctx={props.ctx} process={p} onKill={props.onKill} />}</For>
            </tbody>
          </table>
        </div>
        <div class="tm-note tm-xsmall tm-muted">
          Showing {shown().length} of {matches().length} matching ({props.total} processes in total)
          <Show when={matches().length > LIMIT}>. Narrow the search to see the rest.</Show>
        </div>
      </Show>
    </div>
  )
}

interface TreeRow {
  process: ProcessInfo
  depth: number
}

export function buildTree(list: ProcessInfo[]): TreeRow[] {
  const mine = list.filter((p) => p.opencode)
  const ids = new Set(mine.map((p) => p.pid))
  const children = new Map<number, ProcessInfo[]>()
  for (const p of mine) {
    if (!ids.has(p.ppid) || p.ppid === p.pid) continue
    const siblings = children.get(p.ppid) ?? []
    siblings.push(p)
    children.set(p.ppid, siblings)
  }
  const order = (a: ProcessInfo, b: ProcessInfo) => b.cpu - a.cpu || b.memory - a.memory
  const roots = mine.filter((p) => !ids.has(p.ppid) || p.ppid === p.pid).sort((a, b) => Number(b.self) - Number(a.self) || order(a, b))
  const out: TreeRow[] = []
  const seen = new Set<number>()
  const walk = (p: ProcessInfo, depth: number) => {
    if (seen.has(p.pid)) return
    seen.add(p.pid)
    out.push({ process: p, depth })
    for (const child of (children.get(p.pid) ?? []).sort(order)) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return out
}

export function OpenCodeTree(props: {
  ctx: Context
  processes: ProcessInfo[] | undefined
  error: unknown
  message: string
  onKill: KillRequest
}) {
  const ui = props.ctx.ui
  const rows = createMemo(() => buildTree(props.processes ?? []))
  const totals = createMemo(() => {
    const list = rows().map((r) => r.process)
    return { count: list.length, cpu: list.reduce((n, p) => n + p.cpu, 0), memory: list.reduce((n, p) => n + p.memory, 0) }
  })

  return (
    <div class="tm-content">
      <Show when={props.error}>
        <div class="tm-empty tm-error">
          <ui.Icon name="circle-exclamation" />
          <span>{props.message}</span>
        </div>
      </Show>
      <Show when={props.processes} fallback={<Show when={!props.error}><div class="tm-empty tm-muted">Loading…</div></Show>}>
        <div class="tm-totals">
          <div class="tm-stat">
            <span class="tm-faint tm-xsmall">Processes</span>
            <span class="tm-big">{totals().count}</span>
          </div>
          <div class="tm-stat">
            <span class="tm-faint tm-xsmall">CPU</span>
            <span class="tm-big">{pct(totals().cpu, 1)}</span>
          </div>
          <div class="tm-stat">
            <span class="tm-faint tm-xsmall">Memory</span>
            <span class="tm-big">{bytes(totals().memory)}</span>
          </div>
        </div>
        <div class="tm-note tm-xsmall tm-muted">
          The OpenCode server and everything it started: shells, MCP servers, language servers and dev servers.
        </div>
        <div class="tm-table-wrap">
          <table class="tm-table">
            <Head />
            <tbody>
              <For each={rows()}>{(r) => <Row ctx={props.ctx} process={r.process} depth={r.depth} onKill={props.onKill} />}</For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  )
}
