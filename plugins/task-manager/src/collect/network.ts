import { run } from "./exec"

export type NetCounters = { rx: number; tx: number }

const physical = /^(en\d+|pdp_ip\d+)$/

/** Sums rx/tx bytes over physical interfaces in `netstat -ibn` (the <Link#> rows, skipping lo0 and tunnels). */
export function parseNetstat(text: string): NetCounters {
  let rx = 0
  let tx = 0
  for (const line of text.split("\n")) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 10 || !cols[2]?.startsWith("<Link#")) continue
    const name = cols[0]!.replace(/\*$/, "")
    if (!physical.test(name)) continue
    // Counters are the trailing columns: Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll.
    const ibytes = Number(cols[cols.length - 5])
    const obytes = Number(cols[cols.length - 2])
    if (Number.isFinite(ibytes)) rx += ibytes
    if (Number.isFinite(obytes)) tx += obytes
  }
  return { rx, tx }
}

export const collectNetwork = async (): Promise<NetCounters> => parseNetstat(await run("netstat", ["-ibn"]))
