import { Plugin } from "@opencode/plugin"
import { killProcess } from "./kill"
import { TaskManager } from "./rpc"
import { Sampler } from "./sampler"

// The server loads the plugin once per location; they all share one sampler. The key is versioned and the entry is
// checked against this module's Sampler class, so a reload with new code never keeps an instance of the old one.
const SHARED = Symbol.for("task-manager.sampler.v1")
type Shared = { sampler: Sampler; refs: number }
const registry = globalThis as typeof globalThis & { [SHARED]?: Shared }

export default Plugin.define({
  id: "task-manager",
  async setup(ctx) {
    let shared = registry[SHARED]
    // An entry from before a code reload belongs to the old module; its instances stop it on their own cleanup.
    if (shared && !(shared.sampler instanceof Sampler)) shared = undefined
    if (!shared) {
      const sampler = new Sampler()
      sampler.start()
      shared = registry[SHARED] = { sampler, refs: 0 }
    }
    shared.refs++
    const sampler = shared.sampler

    const handle =
      <I>(fn: (input: I, signal: AbortSignal) => Promise<unknown> | unknown) =>
      async (input: unknown, context: { signal: AbortSignal; error: (...args: any[]) => any }) => {
        try {
          // RPC outputs must be plain JSON: drop `undefined` fields.
          return JSON.parse(JSON.stringify((await fn(input as I, context.signal)) ?? null))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return context.error("failed", message, { message })
        }
      }

    await ctx.rpc.register(TaskManager, {
      snapshot: handle<{ history?: boolean }>((i) => sampler.snapshot(i?.history === true)),
      processes: handle<{ limit?: number }>((i) => sampler.processList(typeof i?.limit === "number" ? i.limit : undefined)),
      ports: handle<unknown>(() => sampler.portList()),
      kill: handle<{ pid: number; force?: boolean }>((i) => ({
        ok: true,
        message: killProcess(i?.pid, i?.force === true),
      })),
    })

    const mine = shared
    return () => {
      if (--mine.refs > 0) return
      mine.sampler.stop()
      if (registry[SHARED] === mine) delete registry[SHARED]
    }
  },
})
