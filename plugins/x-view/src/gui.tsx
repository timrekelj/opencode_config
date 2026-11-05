import { Command, MenuItem, Panel, Plugin, Style, type PanelTab } from "@opencode/plugin/gui"
import { XView } from "./contract"
import { main } from "./main"
import { XLogo, XTab } from "./gui/view"
import css from "./gui/style.css?inline"

const TAB = "x"

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "X",
      "menu.open": "X",
      "command.open": "Open X",
      "command.group": "X",
    },
  },
  main,
  setup(ctx) {
    ctx.add(Style, css)
    const key = `${ctx.id}:${TAB}`
    const view = ctx.main(XView)

    const tab: PanelTab = {
      id: TAB,
      get title() {
        return ctx.t("panel.title")
      },
      closable: "hover",
      label: () => (
        <span class="xv-tab-label">
          <XLogo />
          <span>{ctx.t("panel.title")}</span>
        </span>
      ),
    }

    ctx.add(Panel, {
      id: TAB,
      region: "side",
      wide: true,
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 80,
        kind: "menu",
        icon: "globe",
      },
      list: (input) => (input.open.includes(TAB) ? [tab] : []),
      render: () => <XTab ctx={ctx} />,
      close: () => {
        view.close().catch(() => {})
      },
    })

    const open = () => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(key, session, { tab: "select" })
    }

    ctx.add(
      MenuItem,
      (): MenuItem => {
        const session = ctx.sessions.current()
        return {
          menu: "session.panel",
          id: "open",
          title: ctx.t("menu.open"),
          icon: "globe",
          keybind: `${ctx.id}.open`,
          opened: !!session && ctx.layout.state(key, session) !== "closed",
          run: open,
        }
      },
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command.open"),
        group: ctx.t("command.group"),
        keywords: "x twitter tweet social feed",
        enabled: ctx.app.platform === "desktop" && !!ctx.sessions.current(),
        run: open,
      }),
    )
  },
})
