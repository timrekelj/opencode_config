import { Rpc } from "@opencode/plugin/rpc"

const str = { type: "string" } as const
const any = { type: "object" } as const
const nullable = {} as const
const empty = { type: "object", properties: {} } as const

const device = (required: string[]) =>
  ({ type: "object", properties: { platform: str, id: str, name: str }, required }) as const

const errors = {
  hub_failed: { type: "object", properties: { message: str } },
} as const

const method = <I extends object, O extends object>(i: I, o: O) => ({ input: i, output: o, errors })

/** The device hubs on the server's machine. */
export const Hub = Rpc.define({
  id: "devices",
  methods: {
    /** Starts the main hub if it is not running and returns its status. */
    start: method(empty, any),
    /** The main hub's status, without starting it. */
    status: method(empty, any),
    /** Stops every hub and starts the main one again. */
    restart: method(empty, any),
    /** Every simulator and emulator, running or not. */
    list: method(empty, any),
    /** Boots a device and waits until it runs; returns it. */
    boot: method(device(["platform", "id"]), any),
    /** Shuts a device down and stops its hub. */
    shutdown: method(device(["platform", "id"]), nullable),
    /** Starts a hub locked to one running device and returns its status. */
    open: method(device(["platform", "id"]), any),
  },
  events: {},
})
