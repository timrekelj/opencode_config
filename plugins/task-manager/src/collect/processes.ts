import type { PortInfo, ProcessInfo } from "../types"
import { run } from "./exec"

const COMMAND_LIMIT = 500

/** Parses ps etime ([[dd-]hh:]mm:ss) into seconds. */
export function parseElapsed(value: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value.trim())
  if (!m) return 0
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4])
}

export type RawProcess = Omit<ProcessInfo, "opencode" | "self">

/** Parses `ps -axo pid=,ppid=,pcpu=,rss=,etime=,user=,comm=` (comm is the rest of the line). */
export function parsePs(text: string): RawProcess[] {
  const out: RawProcess[] = []
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const comm = m[7]!
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      memory: Number(m[4]) * 1024,
      elapsed: parseElapsed(m[5]!),
      user: m[6]!,
      name: comm.slice(comm.lastIndexOf("/") + 1) || comm,
      command: comm,
    })
  }
  return out
}

/** Parses `ps -axww -o pid=,args=` into pid -> full command line. */
export function parseArgs(text: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(.*?)\s*$/.exec(line)
    if (m) map.set(Number(m[1]), m[2]!.length > COMMAND_LIMIT ? m[2]!.slice(0, COMMAND_LIMIT) + "…" : m[2]!)
  }
  return map
}

/** Pids of `root` and every descendant, following ppid links. */
export function descendants(procs: { pid: number; ppid: number }[], root: number): Set<number> {
  const children = new Map<number, number[]>()
  for (const p of procs) {
    if (p.pid === p.ppid) continue
    const list = children.get(p.ppid)
    if (list) list.push(p.pid)
    else children.set(p.ppid, [p.pid])
  }
  const found = new Set<number>([root])
  const stack = [root]
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (found.has(child)) continue
      found.add(child)
      stack.push(child)
    }
  }
  return found
}

/** Joins the two ps outputs and tags the OpenCode server tree. */
export function buildProcesses(raw: RawProcess[], args: Map<number, string>, selfPid: number): ProcessInfo[] {
  const tree = descendants(raw, selfPid)
  return raw
    .map((p) => ({ ...p, command: args.get(p.pid) ?? p.command, opencode: tree.has(p.pid), self: p.pid === selfPid }))
    .sort((a, b) => b.cpu - a.cpu || b.memory - a.memory)
}

export async function collectProcesses(selfPid = process.pid): Promise<ProcessInfo[]> {
  const [ps, args] = await Promise.all([
    run("ps", ["-axo", "pid=,ppid=,pcpu=,rss=,etime=,user=,comm="]),
    run("ps", ["-axww", "-o", "pid=,args="]).catch(() => ""),
  ])
  // This plugin's own ps calls would otherwise show up; they are short lived and harmless but noisy.
  return buildProcesses(parsePs(ps), parseArgs(args), selfPid).filter((p) => !(p.ppid === selfPid && p.name === "ps"))
}

/** Parses `lsof -nP -iTCP -sTCP:LISTEN -F pcnLP` records. */
export function parseLsof(text: string, tree: Set<number>): PortInfo[] {
  const ports = new Map<string, PortInfo>()
  let pid = 0
  let name = ""
  let protocol = "TCP"
  for (const line of text.split("\n")) {
    const tag = line[0]
    const value = line.slice(1)
    if (tag === "p") {
      pid = Number(value)
      name = ""
      protocol = "TCP"
    } else if (tag === "c") name = value
    else if (tag === "P") protocol = value
    else if (tag === "n") {
      const i = value.lastIndexOf(":")
      const port = Number(value.slice(i + 1))
      if (i < 0 || !Number.isInteger(port)) continue
      const address = value.slice(0, i).replace(/^\[(.*)\]$/, "$1")
      const key = `${pid}:${port}:${address}`
      if (!ports.has(key)) ports.set(key, { port, address, protocol, pid, name, opencode: tree.has(pid) })
    }
  }
  return [...ports.values()].sort((a, b) => a.port - b.port || a.pid - b.pid)
}

export async function collectPorts(tree: Set<number>): Promise<PortInfo[]> {
  // lsof exits 1 when nothing matches; treat that as an empty list.
  const out = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcnLP"], 15_000).catch((error: { stdout?: string; code?: number }) => {
    if (error?.code === 1) return ""
    throw error
  })
  return parseLsof(out, tree)
}
