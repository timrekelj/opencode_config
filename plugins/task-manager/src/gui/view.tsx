import type { Context, MountedSession } from "@opencode/plugin/gui"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { HistoryPoint, PortInfo, ProcessInfo, Snapshot } from "../types"
import { alertsAllowed, alertsEnabled, setAlertsEnabled } from "./alerts"
import { errorMessage, killProcess, loadPorts, loadProcesses, loadSnapshot } from "./api"
import { append } from "./format"
import { Overview } from "./overview"
import { Ports } from "./ports"
import { OpenCodeTree, Processes, type KillRequest } from "./processes"

export type ViewId = "overview" | "processes" | "opencode" | "ports"
export interface Prefs {
  view: ViewId
}

const VIEWS: { value: ViewId; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "processes", label: "Processes" },
  { value: "opencode", label: "OpenCode" },
  { value: "ports", label: "Ports" },
]

/**
 * Runs `run` now and then every `ms` while `enabled` and the document is visible. A new run never starts while the
 * previous one is pending; leaving or disabling aborts the request. The returned function runs it again at once.
 */
function poll(ms: number, enabled: () => boolean, run: (signal: AbortSignal) => Promise<void>) {
  const [bump, setBump] = createSignal(0)
  createEffect(() => {
    bump()
    if (!enabled()) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false

    const tick = async () => {
      clearTimeout(timer)
      if (abort.signal.aborted || running) return
      if (document.visibilityState === "visible") {
        running = true
        try {
          await run(abort.signal)
        } catch {
          // run records its own error
        } finally {
          running = false
        }
      }
      if (!abort.signal.aborted) timer = setTimeout(tick, ms)
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick()
    }
    document.addEventListener("visibilitychange", onVisible)
    void tick()
    onCleanup(() => {
      abort.abort()
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
    })
  })
  return () => setBump((n) => n + 1)
}

function Segmented(props: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div class="tm-segmented" role="tablist" aria-label={props.label}>
      <For each={props.options}>
        {(o) => (
          <button
            class="tm-segment"
            classList={{ "tm-segment-active": props.value === o.value }}
            role="tab"
            aria-selected={props.value === o.value}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  )
}

export function TaskManagerView(props: {
  ctx: Context
  prefs: Prefs
  setPrefs: (next: Partial<Prefs>) => void
  session: () => MountedSession | undefined
  variant: "panel" | "page"
}) {
  const ctx = props.ctx
  const directory = () => props.session()?.directory ?? ctx.sessions.current()?.directory
  const view = () => props.prefs.view

  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [history, setHistory] = createSignal<HistoryPoint[]>([])
  const [snapshotError, setSnapshotError] = createSignal<unknown>()
  const [processes, setProcesses] = createSignal<ProcessInfo[]>()
  const [total, setTotal] = createSignal(0)
  const [processError, setProcessError] = createSignal<unknown>()
  const [ports, setPorts] = createSignal<PortInfo[]>()
  const [portError, setPortError] = createSignal<unknown>()

  poll(
    2000,
    () => true,
    async (signal) => {
      // Ask for history on the first load and after a gap (hidden panel); otherwise append the new point.
      const last = history().at(-1)
      const needHistory = !last || Date.now() - last.t > 6000
      try {
        const next = await loadSnapshot(ctx, { history: needHistory, directory: directory() }, signal)
        if (signal.aborted) return
        setSnapshot(next)
        setHistory(needHistory && next.history ? next.history : append(history(), next))
        setSnapshotError(undefined)
      } catch (error) {
        if (!signal.aborted) setSnapshotError(error ?? new Error("Unknown error"))
      }
    },
  )

  const refreshProcesses = poll(
    3000,
    () => view() === "processes" || view() === "opencode",
    async (signal) => {
      try {
        const next = await loadProcesses(ctx, { directory: directory() }, signal)
        if (signal.aborted) return
        setProcesses(next.processes)
        setTotal(next.total)
        setProcessError(undefined)
      } catch (error) {
        if (!signal.aborted) setProcessError(error ?? new Error("Unknown error"))
      }
    },
  )

  const refreshPorts = poll(
    5000,
    () => view() === "ports",
    async (signal) => {
      try {
        const next = await loadPorts(ctx, { directory: directory() }, signal)
        if (signal.aborted) return
        setPorts(next.ports)
        setPortError(undefined)
      } catch (error) {
        if (!signal.aborted) setPortError(error ?? new Error("Unknown error"))
      }
    },
  )

  const onKill: KillRequest = async (target, force) => {
    const what = `${target.name} (${target.pid})`
    const ok = await ctx.dialogs.confirm({
      title: force ? `Force quit ${what}?` : `Quit ${what}?`,
      description: force
        ? `Sends SIGKILL. The process can't clean up and unsaved work in it is lost.\n${target.command}`
        : `Sends SIGTERM and asks the process to exit.\n${target.command}`,
      confirm: force ? "Force quit" : "Quit",
      danger: true,
    })
    if (!ok) return
    try {
      const result = await killProcess(ctx, { pid: target.pid, force, directory: directory() }, new AbortController().signal)
      ctx.toast.show({ title: result.ok ? "Signal sent" : "Could not quit the process", description: result.message, variant: result.ok ? "success" : "error" })
    } catch (error) {
      ctx.toast.show({ title: "Could not quit the process", description: errorMessage(error), variant: "error" })
    }
    refreshProcesses()
    refreshPorts()
  }

  return (
    <div class={`tm-root tm-${props.variant}`}>
      <div class="tm-toolbar">
        <Segmented
          label="View"
          value={view()}
          options={VIEWS}
          onChange={(value) => props.setPrefs({ view: value as ViewId })}
        />
        <span class="tm-spacer" />
        <Show when={alertsAllowed(ctx)}>
          <label class="tm-check tm-small tm-muted" title="Notify when memory pressure is critical or a process stays above 90% CPU">
            <input type="checkbox" checked={alertsEnabled()} onChange={(e) => setAlertsEnabled(e.currentTarget.checked)} />
            Alerts
          </label>
        </Show>
      </div>
      <div class="tm-scroll">
        <Show when={view() === "overview"}>
          <Overview ctx={ctx} snapshot={snapshot()} history={history()} error={snapshotError()} message={errorMessage(snapshotError())} />
        </Show>
        <Show when={view() === "processes"}>
          <Processes ctx={ctx} processes={processes()} total={total()} error={processError()} message={errorMessage(processError())} onKill={onKill} />
        </Show>
        <Show when={view() === "opencode"}>
          <OpenCodeTree ctx={ctx} processes={processes()} error={processError()} message={errorMessage(processError())} onKill={onKill} />
        </Show>
        <Show when={view() === "ports"}>
          <Ports ctx={ctx} ports={ports()} error={portError()} message={errorMessage(portError())} onKill={onKill} />
        </Show>
      </div>
    </div>
  )
}
