import { Command, MenuItem, Panel, Plugin, SettingsPage, Style, type PanelTab } from "@opencode/plugin/gui"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { startAlerts } from "./gui/alerts"
import { TaskManagerView, type Prefs } from "./gui/view"
import css from "./gui/style.css?inline"

const TAB = "task-manager"

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Task Manager",
      "menu.open": "Task Manager",
      "command.open": "Show Task Manager",
      "command.group": "Task Manager",
      "settings.title": "Task Manager",
    },
  },
  setup(ctx) {
    // Shared by the panel and the settings page so both remember the same view while the app runs.
    const [prefs, setPrefs] = createStore<Prefs>({ view: "overview" })
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
        order: 71,
        kind: "menu",
        icon: "window-analytics",
      },
      list: (input) => (input.open.includes(TAB) ? [tab] : []),
      render: (props) => (
        <TaskManagerView ctx={ctx} prefs={prefs} setPrefs={setPrefs} session={() => props.session} variant="panel" />
      ),
    })

    const open = () => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(key, session, { tab: "select" })
      else ctx.layout.settings(TAB)
    }

    // Memory pressure and CPU hog alerts: toasts, panel open or not. `alerts: false` in the plugin options disables them.
    const stop = startAlerts(ctx, () => {
      setPrefs({ view: "overview" })
      open()
    })
    if (stop) onCleanup(stop)

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
        keywords: "task manager activity monitor cpu memory gpu processes ports kill network disk battery",
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
          title: "Task Manager",
          description: "CPU, memory, GPU, network, processes and ports",
          keywords: "task manager activity monitor cpu memory gpu processes ports kill",
        },
      ],
      render: () => (
        <TaskManagerView ctx={ctx} prefs={prefs} setPrefs={setPrefs} session={() => ctx.sessions.current()} variant="page" />
      ),
    })
  },
})
