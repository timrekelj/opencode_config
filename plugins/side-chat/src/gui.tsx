import { Command, MenuItem, Panel, Plugin, Store, Style, type PanelTab, type SessionRef } from "@opencode/plugin/gui"
import { Chat } from "./gui/chat"
import { errorMessage, makeForks, Owned } from "./gui/forks"
import css from "./gui/style.css?inline"

const TAB = "chat"

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Side chat",
      "menu.open": "Side chat",
      "command.open": "Open side chat",
      "command.ask": "Ask in side chat",
      "command.group": "Side chat",
    },
  },
  stores: {
    // Every fork this app made and has not deleted yet, so one a closed window left behind is cleaned up.
    owned: Store.global(Owned, { forks: [] }),
  },
  setup(ctx) {
    ctx.add(Style, css)
    const forks = makeForks(ctx, ctx.stores.owned)
    const key = `${ctx.id}:${TAB}`

    const tab: PanelTab = {
      id: TAB,
      get title() {
        return ctx.t("panel.title")
      },
      closable: "hover",
      label: () => (
        <span class="sc-tab-label">
          <ctx.ui.Icon name="speech-bubble" size="small" />
          <span>{ctx.t("panel.title")}</span>
        </span>
      ),
    }

    const open = (session: SessionRef) => {
      ctx.layout.open(key, session)
      return forks.start(session)
    }

    /** Opens the side chat and asks `text` there once the fork is ready. */
    const ask = async (session: SessionRef, text: string) => {
      await open(session)
      const sessionID = forks.get(session.key)?.id
      if (!sessionID) return
      try {
        await session.server.data.session.prompt({ sessionID, text })
      } catch (error) {
        ctx.toast.show({ title: ctx.t("panel.title"), description: errorMessage(error), variant: "error" })
      }
    }

    ctx.add(Panel, {
      id: TAB,
      region: "side",
      // A side chat lives as long as its tab; a window reload does not bring it back.
      transient: true,
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 75,
        kind: "menu",
        icon: "speech-bubble",
      },
      list: (input) => (input.open.includes(TAB) ? [tab] : []),
      render: (props) => (
        <Chat
          ctx={ctx}
          forks={forks}
          session={props.session}
          screen={props.screen}
          onClose={() => ctx.layout.close(key, props.session)}
        />
      ),
      close: (input) => forks.discard(input.session.key),
      closed: () => false as const,
    })

    ctx.add(
      MenuItem,
      (): MenuItem => {
        const session = ctx.sessions.current()
        return {
          menu: "session.panel",
          id: "open",
          title: ctx.t("menu.open"),
          icon: "speech-bubble",
          keybind: `${ctx.id}.open`,
          opened: !!session && ctx.layout.state(key, session) !== "closed",
          run: () => {
            const session = ctx.sessions.current()
            if (session) void open(session)
          },
        }
      },
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command.open"),
        group: ctx.t("command.group"),
        keywords: "btw aside side question fork temporary chat",
        section: "session",
        bind: "mod+shift+b",
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) void open(session)
        },
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "ask",
        title: ctx.t("command.ask"),
        group: ctx.t("command.group"),
        keywords: "btw aside side question fork temporary chat",
        section: "session",
        slash: { name: "side", arguments: true },
        enabled: !!ctx.sessions.current(),
        run: (text) => {
          const session = ctx.sessions.current()
          if (!session) return
          if (text?.trim()) void ask(session, text.trim())
          else void open(session)
        },
      }),
    )
  },
})
