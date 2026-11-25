import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DiscordIpc, encode, FrameReader, socketPaths } from "./ipc"
import type { Activity } from "./presence"

const activity = (state: string): Activity => ({
  details: "app",
  state,
  timestamps: { start: 1 },
  assets: { large_image: "opencode", large_text: "OpenCode" },
})

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 10))
  }
}

type Fake = { path: string; frames: { op: number; data: any }[]; sockets: net.Socket[]; close: () => void }

function fake(dir: string, opts: { split?: boolean; ping?: boolean } = {}): Promise<Fake> {
  const path = join(dir, "discord-ipc-0")
  const state: Fake = { path, frames: [], sockets: [], close() {} }
  const server = net.createServer((socket) => {
    state.sockets.push(socket)
    const reader = new FrameReader()
    socket.on("error", () => {})
    socket.on("data", (chunk) => {
      for (const frame of reader.push(chunk)) {
        state.frames.push(frame)
        if (frame.op === 0) {
          const ready = encode(1, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } })
          if (opts.ping) socket.write(encode(3, { n: 1 }))
          if (opts.split) {
            // Split mid-header and mid-body, and coalesce with a ping frame.
            const all = Buffer.concat([ready, encode(3, { n: 2 })])
            socket.write(all.subarray(0, 3))
            setTimeout(() => socket.write(all.subarray(3, 15)), 10)
            setTimeout(() => socket.write(all.subarray(15)), 20)
          } else socket.write(ready)
        }
      }
    })
  })
  state.close = () => {
    for (const s of state.sockets) s.destroy()
    server.close()
  }
  return new Promise((resolve) => server.listen(path, () => resolve(state)))
}

let dir = ""
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ""
})
const setup = () => {
  // Unix socket paths are length-limited, so keep the directory short.
  dir = mkdtempSync(join(tmpdir(), "dp-"))
  return dir
}
const client = (path: string, logs: string[] = []) => {
  const ipc = new DiscordIpc({
    clientId: "123",
    log: (m) => logs.push(m),
    paths: () => [path],
    retryMinMs: 30,
    retryMaxMs: 60,
    throttleMs: 20,
  })
  cleanups.push(() => void ipc.close())
  return ipc
}

describe("socketPaths", () => {
  test("prefers XDG_RUNTIME_DIR, strips the trailing slash", () => {
    expect(socketPaths({ TMPDIR: "/var/x/" })[3]).toBe("/var/x/discord-ipc-3")
    expect(socketPaths({ XDG_RUNTIME_DIR: "/run/u", TMPDIR: "/t" })[0]).toBe("/run/u/discord-ipc-0")
    expect(socketPaths({})[9]).toBe("/tmp/discord-ipc-9")
  })
})

describe("DiscordIpc trace", () => {
  const traced = (path: string, events: [string, string | undefined][]) => {
    const ipc = new DiscordIpc({
      clientId: "123",
      paths: () => [path],
      retryMinMs: 30,
      retryMaxMs: 60,
      throttleMs: 20,
      trace: (kind, reason) => events.push([kind, reason]),
    })
    cleanups.push(() => void ipc.close())
    return ipc
  }

  test("logs connected, shown and cleared once per transition, not per update", async () => {
    const server = await fake(setup())
    cleanups.push(server.close)
    const events: [string, string | undefined][] = []
    const ipc = traced(server.path, events)
    ipc.setActivity(activity("Working"))
    ipc.start()
    await until(() => server.frames.some((f) => f.op === 1))
    ipc.setActivity(activity("Idle"))
    await until(() => server.frames.filter((f) => f.op === 1).length === 2)
    ipc.setActivity(null, "idle")
    await until(() => server.frames.filter((f) => f.op === 1).length === 3)
    ipc.setActivity(null, "no-sessions")
    await new Promise((r) => setTimeout(r, 100))
    expect(events).toEqual([
      ["connected", undefined],
      ["shown", undefined],
      ["cleared", "idle"],
    ])
  })

  test("logs disconnected, then connected and shown again after a reconnect", async () => {
    const d = setup()
    const first = await fake(d)
    const events: [string, string | undefined][] = []
    const ipc = traced(first.path, events)
    ipc.setActivity(activity("Working"))
    ipc.start()
    await until(() => first.frames.some((f) => f.op === 1))
    first.close()
    await new Promise((r) => setTimeout(r, 50))
    rmSync(first.path, { force: true })
    const second = await fake(d)
    cleanups.push(second.close)
    await until(() => second.frames.some((f) => f.op === 1))
    expect(events.map((e) => e[0])).toEqual(["connected", "shown", "disconnected", "connected", "shown"])
  })

  test("close logs closed and cleared with reason close, without a disconnect", async () => {
    const server = await fake(setup())
    cleanups.push(server.close)
    const events: [string, string | undefined][] = []
    const ipc = traced(server.path, events)
    ipc.setActivity(activity("Working"))
    ipc.start()
    await until(() => server.frames.some((f) => f.op === 1))
    await ipc.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(events.map((e) => e.join(":"))).toEqual(["connected:", "shown:", "closed:", "cleared:close"])
  })
})

describe("DiscordIpc", () => {
  test("handshake, READY, SET_ACTIVITY shape, dedupe, clear", async () => {
    const server = await fake(setup())
    cleanups.push(server.close)
    const ipc = client(server.path)
    ipc.setActivity(activity("Working"))
    ipc.start()
    await until(() => server.frames.some((f) => f.op === 1))
    expect(server.frames[0]).toEqual({ op: 0, data: { v: 1, client_id: "123" } })
    const set = server.frames.find((f) => f.op === 1)!.data
    expect(set.cmd).toBe("SET_ACTIVITY")
    expect(set.args.pid).toBe(process.pid)
    expect(set.args.activity).toEqual(activity("Working"))
    expect(typeof set.nonce).toBe("string")

    ipc.setActivity(activity("Working"))
    await new Promise((r) => setTimeout(r, 100))
    expect(server.frames.filter((f) => f.op === 1).length).toBe(1)

    ipc.setActivity(null)
    await until(() => server.frames.filter((f) => f.op === 1).length === 2)
    expect(server.frames.at(-1)!.data.args.activity).toBeNull()
  })

  test("coalesces rapid updates into the latest", async () => {
    const server = await fake(setup())
    cleanups.push(server.close)
    const ipc = client(server.path)
    ipc.start()
    await until(() => server.frames.some((f) => f.op === 0))
    await new Promise((r) => setTimeout(r, 50))
    ipc.setActivity(activity("a"))
    ipc.setActivity(activity("b"))
    ipc.setActivity(activity("c"))
    await until(() => server.frames.some((f) => f.op === 1))
    await new Promise((r) => setTimeout(r, 100))
    const sets = server.frames.filter((f) => f.op === 1)
    expect(sets.length).toBe(1)
    expect(sets[0].data.args.activity.state).toBe("c")
  })

  test("answers ping with pong, including split and coalesced frames", async () => {
    const server = await fake(setup(), { split: true, ping: true })
    cleanups.push(server.close)
    const ipc = client(server.path)
    ipc.setActivity(activity("Working"))
    ipc.start()
    await until(() => server.frames.some((f) => f.op === 1))
    await until(() => server.frames.filter((f) => f.op === 4).length === 2)
    const pongs = server.frames.filter((f) => f.op === 4).map((f) => f.data)
    expect(pongs).toEqual([{ n: 1 }, { n: 2 }])
  })

  test("reconnects and re-sends the activity after the server drops", async () => {
    const d = setup()
    const first = await fake(d)
    const logs: string[] = []
    const ipc = client(first.path, logs)
    ipc.setActivity(activity("Working"))
    ipc.start()
    await until(() => first.frames.some((f) => f.op === 1))
    first.close()
    await new Promise((r) => setTimeout(r, 50))
    rmSync(first.path, { force: true })
    const second = await fake(d)
    cleanups.push(second.close)
    await until(() => second.frames.some((f) => f.op === 1))
    expect(second.frames.find((f) => f.op === 1)!.data.args.activity).toEqual(activity("Working"))
    // Logged once for the disconnect, not on every retry.
    expect(logs.length).toBeLessThanOrEqual(2)
  })

  test("discord not running: retries quietly and never throws", async () => {
    const d = setup()
    const logs: string[] = []
    const ipc = client(join(d, "discord-ipc-0"), logs)
    ipc.setActivity(activity("x"))
    ipc.start()
    await new Promise((r) => setTimeout(r, 200))
    expect(logs.length).toBe(1) // several failed retries, one log line
  })
})
