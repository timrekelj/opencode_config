import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"

const Key = Schema.Struct({ key: Schema.String })

/** The panel's colors, so the device page blends into it. */
export const Theme = Schema.Struct({ background: Schema.String, border: Schema.String })

/** The device pages main places in each window, one per device tab. */
export const DeviceView = Ipc.define({
  id: "devices",
  methods: {
    /** Loads `url` in the calling window's view for `key`, creating it once, and returns the embed id. */
    // `theme` is optional: after a rebuild, a window and main can briefly run different versions of this contract.
    open: {
      input: Schema.Struct({ key: Schema.String, url: Schema.String, theme: Schema.optional(Theme) }),
      output: Schema.String,
    },
    reload: { input: Key },
    devtools: { input: Key },
    /** Opens or closes the hub's inspector sidebar (location, permissions, camera). */
    inspector: { input: Key },
    /** Disposes the calling window's view for `key`. */
    close: { input: Key },
  },
})
