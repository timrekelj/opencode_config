# task-manager

A macOS task manager for OpenCode: CPU, memory, GPU, network, disk, battery and thermal state, every process, and
every listening TCP port. Nothing here needs sudo.

- **Metrics**: total and per-core CPU with load average, memory (app, wired, compressed, cached, free, swap,
  pressure), GPU utilization and memory, network throughput, disks, battery and thermal level. Ten minutes of history
  are kept for charts.
- **Processes**: all processes with CPU, memory, user, uptime and full command line. The OpenCode server and
  everything it started are marked, so you can see what OpenCode is running.
- **Ports**: listening TCP ports with the owning process.
- **Kill**: SIGTERM, or SIGKILL when forced. pid 1, the OpenCode server and its parent are refused.
- **Panel**: the GUI part (`src/gui.tsx`) shows all of this in a "Task Manager" side panel (also a settings page),
  with four views:
  - **Overview**: cards for CPU (total, user/system, per-core bars, load average, sparkline), Memory (app, wired,
    compressed and cached segments, pressure badge, swap, sparkline), GPU (hidden when absent), Network (rates,
    totals, sparkline), Disk (used and free per disk) and Power (source, battery state with flow in watts, adapter, cycles and health, time remaining, thermal state).
    A section that fails shows its error inside its card.
  - **Processes**: sortable table (click a column header; CPU descending by default) with search by name, command or
    PID, an "OpenCode only" toggle and the full command on hover. At most 200 matches render; a note shows the rest.
  - **OpenCode**: the OpenCode server and everything it started as a tree, with total count, CPU and memory, to spot
    runaway shells, MCP servers, language servers and dev servers.
  - **Ports**: listening TCP ports with the owning process, search, "Open" (http://localhost:PORT in the system
    browser) and "Quit".

  Quit (SIGTERM) and Force quit (SIGKILL) ask for confirmation first and report the result in a toast. The OpenCode
  server's own row has them disabled. The panel polls only while it is open and the window is visible: the snapshot
  every 2 seconds, processes every 3 seconds on the Processes and OpenCode views, ports every 5 seconds on Ports.
- **Alerts**: every 30 seconds, whether or not the panel is open, a toast appears once when memory pressure turns
  critical (again after it was back to normal) and once for each process that stays above 90% CPU for three checks in
  a row, with a button that opens the panel. Turn them off with the plugin option `"alerts": false` in
  `opencode.json`, or with the "Alerts" checkbox in the panel (remembered in localStorage).

## Sources

| Section   | Source                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------- |
| CPU       | `os.cpus()` deltas, `os.loadavg()`                                                                |
| Memory    | `vm_stat`, `sysctl hw.memsize vm.swapusage kern.memorystatus_vm_pressure_level`                   |
| GPU       | `ioreg -r -d 1 -c IOAccelerator` (utilization), `system_profiler SPDisplaysDataType` (name, once) |
| Network   | `netstat -ibn` deltas over `en*` and `pdp_ip*` interfaces                                         |
| Disk      | `df -kP`                                                                                          |
| Power     | `pmset -g batt`, `pmset -g therm`, `ioreg -rw0 -c AppleSmartBattery -a`                           |
| Processes | `ps -axo …` plus `ps -axww -o pid=,args=`                                                         |
| Ports     | `lsof -nP -iTCP -sTCP:LISTEN -F…`, only on request, cached for 3 seconds                          |

Each section fails on its own: a missing tool or an unsupported machine leaves that section out and puts a message
in `errors`. Commands run through `execFile`, never a shell.

### Power details

`ioreg -a` (XML plist, no sudo) adds a precise `state` to the Power section: `charging`, `charged`, `holding` (on AC,
battery idle: optimized charging or a charge limit), `discharging`, `ac-draining` (on AC but the battery still
discharges, so the adapter can't keep up) and `ac` (no battery). `batteryWatts` is voltage x amperage (positive into
the battery; amperage may be reported as an unsigned 64-bit value and is converted from two's complement).
`adapter`, `health` (cycles and capacity against design) and `systemPowerW` (`PowerTelemetryData.SystemLoad`, mW,
equal to input voltage x current) come from the same output. Temperature is not exposed by this ioreg class on
Apple Silicon (the keys are zero), so it is only shown when a plausible value is present. If `ioreg` fails the
`pmset` fields are still returned.

## How it samples

One sampler per server process, shared by every location the server loads the plugin for. It samples every 2
seconds while a panel is polling (an RPC call in the last 30 seconds) and every 10 seconds otherwise. A tick that is
still running is never started twice. Timers stop when the last location unloads the plugin.

The RPC contract is in `src/rpc.ts` (`snapshot`, `processes`, `ports`, `kill`) and its types in `src/types.ts`.

## Development

```sh
bun install
bun run dev        # vite build --watch
bun run typecheck
bun test scripts   # parsers, process tree tagging, kill guards
```

The server part (`src/index.ts`, `src/sampler.ts`, `src/collect/`) runs from source. Restart the service after
changing it: `opencode service restart`.
