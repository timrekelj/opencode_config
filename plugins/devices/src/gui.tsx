import { Command, MenuItem, Panel, Plugin, Style, type PanelTab } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import { DeviceView } from "./contract"
import { main } from "./main"
import { DeviceTab } from "./gui/device"
import { DeviceList } from "./gui/list"
import { PhoneIcon } from "./gui/phone"
import { deviceTabKey, fallbackName, LIST_TAB, makeApp } from "./gui/state"
import css from "./gui/style.css?inline"

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Devices",
      "command.open": "Open devices",
      "command.openDevice": "Open device…",
      "command.restart": "Restart device hub",
      "command.group": "Devices",
      "menu.open": "Devices",
    },
  },
  main,
  setup(ctx) {
    ctx.add(Style, css)
    const app = makeApp(ctx)
    const view = ctx.main(DeviceView)
    const listKey = `${ctx.id}:${LIST_TAB}`

    const tabs = new Map<string, PanelTab>()
    const tabFor = (id: string): PanelTab => {
      const existing = tabs.get(id)
      if (existing) return existing
      const key = deviceTabKey(id)
      const tab: PanelTab =
        key === undefined
          ? {
              id,
              get title() {
                return ctx.t("panel.title")
              },
              closable: "compact",
              fallback: true,
              label: () => (
                <span class="dev-tab-label">
                  <ctx.ui.Icon name="monitor" size="small" />
                  <span>{ctx.t("panel.title")}</span>
                </span>
              ),
            }
          : {
              id,
              get title() {
                return app.device(key)?.name ?? fallbackName(key)
              },
              closable: "hover",
              label: () => (
                <span class="dev-tab-label">
                  <PhoneIcon />
                  <span>{app.device(key)?.name ?? fallbackName(key)}</span>
                  <Show when={app.device(key)?.booted}>
                    <span class="dev-dot dev-dot-running" />
                  </Show>
                </span>
              ),
            }
      tabs.set(id, tab)
      return tab
    }

    ctx.add(Panel, {
      id: "devices",
      region: "side",
      wide: true,
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 70,
        kind: "menu",
        icon: "monitor",
      },
      list: (input) => input.open.filter((id) => id === LIST_TAB || deviceTabKey(id) !== undefined).map(tabFor),
      render: (props) => (
        <Show when={deviceTabKey(props.tab.id)} keyed fallback={<DeviceList app={app} />}>
          {(key) => <DeviceTab app={app} deviceKey={key} />}
        </Show>
      ),
      close: (input) => {
        const key = deviceTabKey(input.tab.id)
        if (key) view.close({ key }).catch(() => {})
      },
    })

    ctx.add(
      MenuItem,
      (): MenuItem => {
        const session = ctx.sessions.current()
        return {
          menu: "session.panel",
          id: "open",
          title: ctx.t("menu.open"),
          icon: "monitor",
          keybind: `${ctx.id}.open`,
          opened: !!session && ctx.layout.state(listKey, session) !== "closed",
          run: app.openList,
        }
      },
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command.open"),
        group: ctx.t("command.group"),
        keywords: "simulator emulator ios android device hub",
        enabled: !!ctx.sessions.current(),
        run: app.openList,
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "openDevice",
        title: ctx.t("command.openDevice"),
        group: ctx.t("command.group"),
        keywords: "simulator emulator ios android device start boot",
        enabled: !!ctx.sessions.current(),
        run: async () => {
          await app.refresh()
          const key = await ctx.dialogs.select({
            title: ctx.t("command.openDevice"),
            placeholder: "Search devices",
            options: app.state.devices.map((device) => ({
              title: device.name,
              description: `${device.version} · ${device.booted ? "Running" : "Stopped"}`,
              value: device.key,
              group: device.platform === "ios" ? "iOS Simulators" : "Android Emulators",
            })),
          })
          const device = key === undefined ? undefined : app.device(key)
          if (device) void app.start(device)
        },
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "restart",
        title: ctx.t("command.restart"),
        group: ctx.t("command.group"),
        keywords: "simulator emulator device hub restart",
        run: () => void app.restart(),
      }),
    )
  },
})
