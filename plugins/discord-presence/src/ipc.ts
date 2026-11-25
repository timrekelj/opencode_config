import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import net from "node:net"
import type { Activity } from "./presence"
import type { TraceKind } from "./trace"

const HANDSHAKE = 0
const FRAME = 1
const CLOSE = 2
const PING = 3
const PONG = 4

export function socketPaths(env: NodeJS.ProcessEnv = process.env) {
  const dir = (env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp").replace(/\/+$/, "") || "/tmp"
  return Array.from({ length: 10 }, (_, i) => `${dir}/discord-ipc-${i}`)
}

export function encode(op: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
  const out = Buffer.alloc(8 + body.length)
  out.writeInt32LE(op, 0)
  out.writeInt32LE(body.length, 4)
  body.copy(out, 8)
  return out
}

/** Splits a byte stream into frames; keeps any partial frame for the next chunk. */
export class FrameReader {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: { op: number; data: any }[] = []
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0)
      const length = this.buffer.readInt32LE(4)
      if (length < 0 || length > 1 << 24) throw new Error("invalid frame length")
      if (this.buffer.length < 8 + length) break
      const text = this.buffer.subarray(8, 8 + length).toString("utf8")
      this.buffer = this.buffer.subarray(8 + length)
      let data: unknown
      try {
        data = text ? JSON.parse(text) : undefined
      } catch {
        data = undefined
      }
      frames.push({ op, data })
    }
    return frames
  }
}

export type IpcOptions = {
  clientId: string
  log?: (message: string) => void
  paths?: () => string[]
  retryMinMs?: number
  retryMaxMs?: number
  /** Minimum gap between SET_ACTIVITY sends. */
  throttleMs?: number
  /** Called on real presence transitions only (connected, disconnected, shown, cleared, closed). Must not throw. */
  trace?: (kind: TraceKind, reason?: string) => void
}

export class DiscordIpc {
  private socket: net.Socket | undefined
  private ready = false
  private closed = false
  private wanted: Activity | null = null
  private sent: string | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private lastSend = 0
  private delay: number
  private warned = false
  private everWanted = false
  private wantedReason: string | undefined
  /** Whether a non-null activity is currently shown on this connection. */
  private visible = false

  constructor(private options: IpcOptions) {
    this.delay = options.retryMinMs ?? 15_000
  }

  start() {
    this.closed = false
    this.connect()
  }

  /** Sets the activity to show; null clears it. Sends are coalesced and deduplicated. */
  setActivity(activity: Activity | null, reason?: string) {
    this.wanted = activity
    this.wantedReason = reason
    this.everWanted = true
    this.schedule()
  }

  async close() {
    this.closed = true
    clearTimeout(this.retry)
    clearTimeout(this.flushTimer)
    this.trace("closed")
    const socket = this.socket
    if (!socket) return
    // Clear the presence right away so it does not linger after the process exits.
    if (this.ready && this.sent !== "null" && !socket.destroyed) {
      this.write(socket, FRAME, this.command(null))
      if (this.visible) this.trace("cleared", "close")
      this.visible = false
    }
    this.socket = undefined
    this.ready = false
    await new Promise<void>((resolve) => socket.end(resolve))
    socket.destroy()
  }

  private connect() {
    if (this.closed || this.socket) return
    const paths = (this.options.paths ?? socketPaths)().filter((p) => existsSync(p))
    this.tryPaths(paths)
  }

  private tryPaths(paths: string[]) {
    if (this.closed) return
    const path = paths.shift()
    if (!path) return this.failed()
    const socket = net.createConnection(path)
    const reader = new FrameReader()
    let opened = false
    this.socket = socket
    socket.on("connect", () => {
      opened = true
      this.write(socket, HANDSHAKE, { v: 1, client_id: this.options.clientId })
    })
    socket.on("data", (chunk) => {
      try {
        for (const frame of reader.push(chunk)) this.frame(socket, frame)
      } catch {
        socket.destroy()
      }
    })
    socket.on("error", () => {})
    socket.on("close", () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.ready = false
      this.sent = undefined
      this.visible = false
      if (this.closed) return
      if (!opened) return this.tryPaths(paths)
      this.trace("disconnected")
      this.failed("disconnected")
    })
  }

  private frame(socket: net.Socket, frame: { op: number; data: any }) {
    if (frame.op === PING) return this.write(socket, PONG, frame.data ?? {})
    if (frame.op === CLOSE) return socket.destroy()
    if (frame.op !== FRAME) return
    if (frame.data?.evt === "READY") {
      this.ready = true
      this.delay = this.options.retryMinMs ?? 15_000
      this.warned = false
      this.sent = undefined
      this.lastSend = 0
      this.visible = false
      this.trace("connected")
      if (this.everWanted) this.schedule()
    } else if (frame.data?.evt === "ERROR") {
      this.options.log?.(`discord rejected the request: ${frame.data?.data?.message ?? "unknown error"}`)
    }
  }

  private failed(reason = "discord is not running") {
    if (this.closed || this.retry) return
    if (!this.warned) {
      this.warned = true
      this.options.log?.(`${reason}; retrying in the background`)
    }
    const wait = this.delay
    this.delay = Math.min(this.delay * 2, this.options.retryMaxMs ?? 60_000)
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.connect()
    }, wait)
  }

  private schedule() {
    if (!this.ready || this.flushTimer || this.closed) return
    const wait = Math.max(0, this.lastSend + (this.options.throttleMs ?? 4_000) - Date.now())
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, wait)
  }

  private flush() {
    const socket = this.socket
    if (!socket || !this.ready || this.closed) return
    const key = JSON.stringify(this.wanted)
    if (key === this.sent) return
    this.sent = key
    this.lastSend = Date.now()
    this.write(socket, FRAME, this.command(this.wanted))
    if (this.wanted && !this.visible) {
      this.visible = true
      this.trace("shown")
    } else if (!this.wanted && this.visible) {
      this.visible = false
      this.trace("cleared", this.wantedReason ?? "unknown")
    }
  }

  private trace(kind: TraceKind, reason?: string) {
    try {
      this.options.trace?.(kind, reason)
    } catch {}
  }

  private command(activity: Activity | null) {
    return { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity }, nonce: randomUUID() }
  }

  private write(socket: net.Socket, op: number, payload: unknown) {
    if (!socket.destroyed) socket.write(encode(op, payload))
  }
}
