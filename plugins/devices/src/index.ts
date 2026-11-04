import { Plugin } from "@opencode/plugin"
import { Hubs } from "./hub"
import { Hub } from "./rpc"
import type { Platform } from "./types"

const str = (value: unknown) => (typeof value === "string" && value ? value : undefined)

interface DeviceInput {
  platform: Platform
  id: string
}

export default Plugin.define({
  id: "devices",
  async setup(ctx) {
    const hubs = new Hubs({
      node: str(ctx.options.node),
      androidHome: str(ctx.options.androidHome),
      javaHome: str(ctx.options.javaHome),
      args: Array.isArray(ctx.options.args) ? ctx.options.args.map(String) : undefined,
    })

    const handle =
      <I, O>(fn: (input: I) => Promise<O> | O) =>
      async (input: unknown, context: { error: (...args: any[]) => any }) => {
        try {
          return JSON.parse(JSON.stringify((await fn(input as I)) ?? null))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return context.error("hub_failed", message, { message })
        }
      }

    await ctx.rpc.register(Hub, {
      restart: handle(() => hubs.restart()),
      list: handle(() => hubs.list()),
      boot: handle<DeviceInput, unknown>((i) => hubs.boot(i)),
      shutdown: handle<DeviceInput, unknown>((i) => hubs.shutdown(i)),
      open: handle<DeviceInput, unknown>((i) => hubs.open(i)),
    } as any)

    return () => hubs.stop()
  },
})
