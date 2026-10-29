import { Command, MenuItem, Plugin } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin/gui/browser"

const DEFAULT_URL = "https://x.com/home"

export default Plugin.define({
  i18n: {
    en: {
      "menu.open": "X",
      "command.open": "Open X",
      "command.group": "X",
    },
  },
  setup(ctx) {
    const url = () => {
      const option = ctx.options.url
      if (typeof option !== "string") return DEFAULT_URL
      const target = option.trim()
      try {
        const { protocol } = new URL(target)
        return protocol === "http:" || protocol === "https:" ? target : DEFAULT_URL
      } catch {
        return DEFAULT_URL
      }
    }

    const open = () => {
      const target = url()
      const session = ctx.sessions.current()
      const live = ctx.use(Browser)()
      // x.com sends X-Frame-Options: SAMEORIGIN, so it cannot be iframed into a custom tab; the
      // desktop browser pane loads it as a top-level tab in the session's side panel instead.
      if (session && live.status === "active" && live.value.attached(session) && live.value.canOpen(session, target)) {
        live.value.open(session, target)
        return
      }
      // No browser pane for this session (web app, pane off): fall back to the system browser.
      ctx.system.openExternal(target)
    }

    ctx.add(
      MenuItem,
      (): MenuItem => ({
        menu: "session.panel",
        id: "open",
        title: ctx.t("menu.open"),
        icon: "globe",
        keybind: `${ctx.id}.open`,
        run: open,
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command.open"),
        group: ctx.t("command.group"),
        keywords: "x twitter tweet social feed",
        run: open,
      }),
    )
  },
})
