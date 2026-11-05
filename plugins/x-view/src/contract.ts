import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"

/** The calling window's X page: where it is and what the toolbar can do. */
export const Page = Schema.Struct({
  url: Schema.String,
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  /** Scrolling is blocked because no agent is working. */
  locked: Schema.Boolean,
})

/** The X page main places in each window, in its own persistent partition so the login survives restarts. */
export const XView = Ipc.define({
  id: "x-view",
  state: Page,
  methods: {
    /** Creates the calling window's view once, loading the start page, and returns the embed id. */
    open: { input: Schema.Struct({ background: Schema.String }), output: Schema.String },
    back: {},
    forward: {},
    reload: {},
    /** Loads the start page again. */
    home: {},
    devtools: {},
    /** Blocks or allows scrolling the calling window's page. The GUI locks it while no agent is working. */
    lock: { input: Schema.Struct({ locked: Schema.Boolean }) },
    /** Disposes the calling window's view. The login stays in the partition. */
    close: {},
  },
})
