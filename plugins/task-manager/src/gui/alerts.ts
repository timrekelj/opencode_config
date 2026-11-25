import type { Context } from "@opencode/plugin/gui"
import { createSignal } from "solid-js"
import { loadProcesses, loadSnapshot } from "./api"
import { pct } from "./format"

const CHECK_MS = 30 * 1000
const FIRST_CHECK_MS = 10 * 1000
const CPU_LIMIT = 90
const CPU_CHECKS = 3
/** Seconds a process must have been running, so short compiler jobs don't fire. */
const MIN_ELAPSED = 60
const STORAGE_KEY = "task-manager.alerts"

/** The plugin option `alerts: false` turns the alerts off for good and hides the panel's toggle. */
export const alertsAllowed = (ctx: Pick<Context, "options">) => ctx.options.alerts !== false

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off"
  } catch {
    return true
  }
}

const [enabled, setEnabled] = createSignal(read())

/** The panel's toggle, remembered in localStorage. */
export const alertsEnabled = enabled
export function setAlertsEnabled(value: boolean) {
  setEnabled(value)
  try {
    localStorage.setItem(STORAGE_KEY, value ? "on" : "off")
  } catch {
    // Storage is unavailable: the choice lasts until the window reloads.
  }
}

/**
 * Checks memory pressure and CPU hogs in the background and shows a toast, whether or not the panel is open:
 * once when memory pressure turns critical (again after it was back to normal), and once per process that stays above
 * 90% CPU for three checks in a row.
 */
export function startAlerts(ctx: Context, openPanel: () => void) {
  if (!alertsAllowed(ctx)) return
  let critical = false
  const hot = new Map<number, number>()
  const told = new Set<number>()
  let running = false

  const check = async () => {
    if (!enabled() || running) return
    running = true
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 20 * 1000)
    try {
      const directory = ctx.sessions.current()?.directory
      const [snapshot, list] = await Promise.all([
        loadSnapshot(ctx, { history: false, directory }, abort.signal),
        loadProcesses(ctx, { directory }, abort.signal),
      ])

      const pressure = snapshot.memory?.pressure
      if (pressure === 4 && !critical) {
        critical = true
        ctx.toast.show({
          title: "Memory pressure is critical",
          description: snapshot.memory ? `${Math.round((snapshot.memory.used / snapshot.memory.total) * 100)}% of memory in use, swap ${Math.round(snapshot.memory.swapUsed / 1024 ** 2)} MB.` : undefined,
          variant: "error",
          icon: "warning",
          persistent: true,
          actions: [{ label: "Show Task Manager", run: openPanel }],
        })
      } else if (pressure !== undefined && pressure !== 4) critical = false

      const current = new Set<number>()
      for (const p of list.processes) {
        if (p.cpu < CPU_LIMIT || p.elapsed < MIN_ELAPSED) continue
        current.add(p.pid)
        const count = (hot.get(p.pid) ?? 0) + 1
        hot.set(p.pid, count)
        if (count < CPU_CHECKS || told.has(p.pid)) continue
        told.add(p.pid)
        ctx.toast.show({
          title: `${p.name} is using ${pct(p.cpu)} CPU`,
          description: `PID ${p.pid}${p.opencode ? ", started by OpenCode" : ""}. It has stayed above ${CPU_LIMIT}% for ${CPU_CHECKS} checks.`,
          variant: "error",
          icon: "warning",
          actions: [{ label: "Show Task Manager", run: openPanel }],
        })
      }
      // Only consecutive checks count; a process that cooled down starts over and may warn again later.
      for (const pid of [...hot.keys()]) if (!current.has(pid)) hot.delete(pid)
      for (const pid of [...told]) if (!current.has(pid)) told.delete(pid)
    } catch {
      // The server is restarting or the RPC failed: the panel shows why; stay quiet here.
    } finally {
      clearTimeout(timeout)
      running = false
    }
  }

  const first = setTimeout(check, FIRST_CHECK_MS)
  const timer = setInterval(check, CHECK_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
