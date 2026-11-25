import type { Context } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { PortInfo } from "../types"
import type { KillRequest } from "./processes"

export function Ports(props: {
  ctx: Context
  ports: PortInfo[] | undefined
  error: unknown
  message: string
  onKill: KillRequest
}) {
  const ui = props.ctx.ui
  const [query, setQuery] = createSignal("")

  const list = createMemo(() => {
    const q = query().trim().toLowerCase()
    return (props.ports ?? [])
      .filter((p) => !q || String(p.port).includes(q) || p.name.toLowerCase().includes(q) || String(p.pid) === q || p.address.includes(q))
      .sort((a, b) => a.port - b.port || a.pid - b.pid)
  })

  const open = (port: number) => props.ctx.system.openExternal(`http://localhost:${port}`)

  return (
    <div class="tm-content">
      <div class="tm-filters">
        <input
          class="tm-search"
          type="search"
          placeholder="Search port, process or PID"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          aria-label="Search ports"
        />
      </div>
      <Show when={props.error}>
        <div class="tm-empty tm-error">
          <ui.Icon name="circle-exclamation" />
          <span>{props.message}</span>
        </div>
      </Show>
      <Show when={props.ports} fallback={<Show when={!props.error}><div class="tm-empty tm-muted">Loading…</div></Show>}>
        <Show when={list().length > 0} fallback={<div class="tm-empty tm-muted">No listening ports found.</div>}>
          <div class="tm-table-wrap">
            <table class="tm-table">
              <thead>
                <tr>
                  <th class="tm-th tm-num">Port</th>
                  <th class="tm-th">Address</th>
                  <th class="tm-th tm-th-name">Process</th>
                  <th class="tm-th tm-num">PID</th>
                  <th class="tm-th" />
                </tr>
              </thead>
              <tbody>
                <For each={list()}>
                  {(p) => (
                    <tr class="tm-tr" title={`${p.protocol} ${p.address}:${p.port}`}>
                      <td class="tm-num tm-mono">{p.port}</td>
                      <td class="tm-mono tm-muted">{p.address}</td>
                      <td class="tm-td-name">
                        <span class="tm-name">
                          <span class="tm-ellipsis">{p.name}</span>
                          <Show when={p.opencode}>
                            <span class="tm-badge tm-badge-oc">OpenCode</span>
                          </Show>
                        </span>
                      </td>
                      <td class="tm-num tm-mono">{p.pid}</td>
                      <td class="tm-td-actions">
                        <span class="tm-actions">
                          <span title={`Open http://localhost:${p.port}`}>
                            <ui.Button size="small" variant="ghost" onClick={() => open(p.port)}>
                              Open
                            </ui.Button>
                          </span>
                          <span title="Quit process (SIGTERM)">
                            <ui.Button
                              size="small"
                              variant="ghost"
                              onClick={() => props.onKill({ pid: p.pid, name: p.name, command: `${p.name} (port ${p.port})` }, false)}
                            >
                              Quit
                            </ui.Button>
                          </span>
                        </span>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </div>
  )
}
