import { Plugin } from "@opencode/plugin"

// Everything happens in the GUI (src/gui.tsx) through the server's own session API; the server part only registers
// the package so the app loads its `./gui-experimental` bundle.
export default Plugin.define({
  id: "side-chat",
  async setup() {},
})
