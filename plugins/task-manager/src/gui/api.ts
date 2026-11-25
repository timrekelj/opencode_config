import type { Context } from "@opencode/plugin/gui"
import { TaskManager } from "../rpc"
import type { KillResult, PortList, ProcessList, Snapshot } from "../types"

type Rpc = {
  snapshot(input: { history?: boolean }, options: object): Promise<Snapshot>
  processes(input: { limit?: number }, options: object): Promise<ProcessList>
  ports(input: object, options: object): Promise<PortList>
  kill(input: { pid: number; force?: boolean }, options: object): Promise<KillResult>
}

export function errorMessage(error: unknown): string {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  const value = error as { message?: unknown; data?: { message?: unknown } }
  if (typeof value.data?.message === "string") return value.data.message
  if (typeof value.message === "string") return value.message
  return String(error)
}

/** The directory the RPC was last answered for, so polling does not list sessions on every call. */
let remembered: string | undefined

/** The RPC is answered per location; without a session, borrow the directory of any recent one. */
async function options(ctx: Pick<Context, "client">, directory: string | undefined, signal: AbortSignal) {
  let dir = directory ?? remembered
  if (!dir) {
    const recent = await ctx.client.session.list({ limit: 1, order: "desc" }, { signal })
    dir = recent.data[0]?.location.directory
  }
  remembered = dir
  return dir ? { location: { directory: dir }, signal } : { signal }
}

// ctx.client changes after a server restart, so it is read on every call.
async function call<T>(
  ctx: Pick<Context, "client">,
  directory: string | undefined,
  signal: AbortSignal,
  fn: (rpc: Rpc, options: object) => Promise<T>,
): Promise<T> {
  const opts = await options(ctx, directory, signal)
  const rpc = ctx.client.rpc(TaskManager) as unknown as Rpc
  try {
    return await fn(rpc, opts)
  } catch (error) {
    // The remembered directory may be gone; forget it so the next call picks another.
    if (!signal.aborted) remembered = undefined
    throw error
  }
}

export const loadSnapshot = (ctx: Pick<Context, "client">, input: { history?: boolean; directory?: string }, signal: AbortSignal) =>
  call(ctx, input.directory, signal, (rpc, o) => rpc.snapshot({ history: input.history === true }, o))

export const loadProcesses = (ctx: Pick<Context, "client">, input: { directory?: string }, signal: AbortSignal) =>
  call(ctx, input.directory, signal, (rpc, o) => rpc.processes({}, o))

export const loadPorts = (ctx: Pick<Context, "client">, input: { directory?: string }, signal: AbortSignal) =>
  call(ctx, input.directory, signal, (rpc, o) => rpc.ports({}, o))

export const killProcess = (
  ctx: Pick<Context, "client">,
  input: { pid: number; force: boolean; directory?: string },
  signal: AbortSignal,
) => call(ctx, input.directory, signal, (rpc, o) => rpc.kill({ pid: input.pid, force: input.force }, o))
