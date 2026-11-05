import { Plugin } from "@opencode/plugin"

// The view lives in the desktop GUI (src/gui.tsx and src/main.ts), which read the plugin's options (`url`) as
// ctx.options. The server part only exists so the package has a "." entry.
export default Plugin.define({
  id: "x-view",
  setup() {},
})
