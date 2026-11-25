import os from "node:os"
import type { CpuInfo } from "../types"

export type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number }

export const readCpuTimes = (): CpuTimes[] => os.cpus().map((c) => c.times)

const sum = (t: CpuTimes) => t.user + t.nice + t.sys + t.idle + t.irq

const pct = (value: number, total: number) => (total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0)

/** CPU use between two readings (pass an all-zero baseline for use since boot). */
export function cpuUsage(prev: CpuTimes[], next: CpuTimes[]): Omit<CpuInfo, "load"> {
  const zero: CpuTimes = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
  const perCore: number[] = []
  const acc = { user: 0, sys: 0, idle: 0, total: 0 }
  next.forEach((n, i) => {
    const p = prev[i] ?? zero
    const d = { user: n.user - p.user + (n.nice - p.nice), sys: n.sys - p.sys + (n.irq - p.irq), idle: n.idle - p.idle }
    const total = d.user + d.sys + d.idle
    perCore.push(pct(d.user + d.sys, total))
    acc.user += d.user
    acc.sys += d.sys
    acc.idle += d.idle
    acc.total += total
  })
  return {
    total: pct(acc.user + acc.sys, acc.total),
    user: pct(acc.user, acc.total),
    system: pct(acc.sys, acc.total),
    idle: pct(acc.idle, acc.total),
    perCore,
  }
}

export const sameTimes = (a: CpuTimes[], b: CpuTimes[]) => a.length === b.length && a.every((x, i) => sum(x) === sum(b[i]!))

export function collectCpu(prev: CpuTimes[] | undefined): { info: CpuInfo; times: CpuTimes[] } {
  const times = readCpuTimes()
  const [a, b, c] = os.loadavg()
  const base = prev && !sameTimes(prev, times) ? prev : []
  return { info: { ...cpuUsage(base, times), load: [a ?? 0, b ?? 0, c ?? 0] }, times }
}
