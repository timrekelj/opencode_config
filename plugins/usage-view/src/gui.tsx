import { Command, MenuItem, Panel, Plugin, SettingsPage, Style, type PanelTab } from "@opencode/plugin/gui"
import { createStore } from "solid-js/store"
import { UsageView, type Prefs } from "./gui/usage"
import css from "./gui/style.css?inline"

const TAB = "usage"

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Usage",
      "menu.open": "Usage",
      "command.open": "Show usage",
      "command.group": "Usage",
      "settings.title": "Usage",
    },
  },
  setup(ctx) {
    // Shared by the panel and the settings page so both remember the same choices while the app runs.
    const [prefs, setPrefs] = createStore<Prefs>({ range: "7d", scope: "project", metric: "cost" })
    const key = `${ctx.id}:${TAB}`

    ctx.add(Style, css)

    const tab: PanelTab = {
      id: TAB,
      get title() {
        return ctx.t("panel.title")
      },
      closable: "compact",
      fallback: true,
    }

    ctx.add(Panel, {
      id: TAB,
      region: "side",
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 70,
        kind: "menu",
        icon: "window-analytics",
      },
      list: (input) => (input.open.includes(TAB) ? [tab] : []),
      render: (props) => (
        <UsageView ctx={ctx} prefs={prefs} setPrefs={setPrefs} session={() => props.session} variant="panel" />
      ),
    })

    const open = () => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(key, session, { tab: "select" })
      else ctx.layout.settings(TAB)
    }

    ctx.add(
      MenuItem,
      (): MenuItem => {
        const session = ctx.sessions.current()
        return {
          menu: "session.panel",
          id: "open",
          title: ctx.t("menu.open"),
          icon: "window-analytics",
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
        keywords: "usage tokens cost billing spend stats models",
        run: open,
      }),
    )

    ctx.add(SettingsPage, {
      id: TAB,
      get title() {
        return ctx.t("settings.title")
      },
      icon: "window-analytics",
      entries: [
        {
          id: TAB,
          title: "Usage",
          description: "Token usage and estimated API cost",
          keywords: "usage tokens cost billing spend stats",
        },
      ],
      render: () => (
        <UsageView ctx={ctx} prefs={prefs} setPrefs={setPrefs} session={() => ctx.sessions.current()} variant="page" />
      ),
    })
  },
})
