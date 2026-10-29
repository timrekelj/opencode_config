import {
  Command,
  ComposerPill,
  createKeyed,
  MenuItem,
  Panel,
  Plugin,
  Style,
  type PanelTab,
  type SessionRef,
} from "@opencode/plugin/gui"
import { createSignal, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { CurrentPr, DraftComment, RepoStatus } from "./types"
import { makeApi, makeGitApi } from "./gui/api"
import { showErrorToast } from "./gui/errors"
import { BRANCHES_TAB, LIST_TAB, prKey, prTabId, prTabNumber, type App } from "./gui/app"
import { BranchesView, checkoutFlow, newBranchFlow } from "./gui/branches"
import { DetailView } from "./gui/detail"
import { ListView } from "./gui/list"
import { checkIcon, checkLabel } from "./gui/util"
import css from "./gui/style.css?inline"

const CURRENT_REFRESH_MS = 2 * 60 * 1000

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Pull requests",
      "panel.branches": "Branches",
      "command.open": "Open pull requests",
      "command.pick": "Open pull request…",
      "command.current": "Open pull request for current branch",
      "command.branches": "Open branches",
      "command.checkout": "Checkout branch…",
      "command.newBranch": "New branch…",
      "command.group": "GitHub",
      "menu.open": "Pull requests",
      "menu.branches": "Branches",
      "pill.title": "Pull request for this branch",
      "pill.branch": "Current branch",
    },
  },
  setup(ctx) {
    const api = makeApi(ctx)
    const git = makeGitApi(ctx)
    const [titles, setTitles] = createStore<Record<string, string>>({})
    const [drafts, mutateDrafts] = ctx.storage.memory("drafts", { initial: {} as Record<string, DraftComment[]> })
    const [current, setCurrent] = createStore<Record<string, CurrentPr | null>>({})
    const [branch, setBranch] = createStore<Record<string, RepoStatus | null>>({})
    const [branchTick, setBranchTick] = createSignal(0)

    const listKey = `${ctx.id}:${LIST_TAB}`
    const branchesKey = `${ctx.id}:${BRANCHES_TAB}`

    const optionLimit = Number(ctx.options.limit)

    const app: App = {
      ctx,
      api,
      git,
      graphLimit: Number.isFinite(optionLimit) && optionLimit > 0 ? optionLimit : 300,
      get drafts() {
        return drafts
      },
      updateDrafts: (key, fn) =>
        mutateDrafts((draft) => {
          draft[key] = fn(draft[key] ?? [])
        }),
      titles,
      setTitle: (key, title) => setTitles(key, title),
      openList: (session) => ctx.layout.open(listKey, session, { tab: "select" }),
      openBranches: (session) => ctx.layout.open(branchesKey, session, { tab: "select" }),
      openPr: (session, number) => ctx.layout.open(`${ctx.id}:${prTabId(number)}`, session, { tab: "select" }),
      branchTick,
      bumpBranch: () => setBranchTick((v) => v + 1),
    }

    ctx.add(Style, css)

    // --- panel tabs ---------------------------------------------------------------------------------------------------

    const tabs = new Map<string, PanelTab>()
    const tabFor = (id: string): PanelTab => {
      const existing = tabs.get(id)
      if (existing) return existing
      const number = prTabNumber(id)
      const tab: PanelTab =
        id === BRANCHES_TAB
          ? {
              id,
              get title() {
                return ctx.t("panel.branches")
              },
              closable: "compact",
              label: () => (
                <span class="prr-tab-label">
                  <ctx.ui.Icon name="branch" size="small" />
                  <span>{ctx.t("panel.branches")}</span>
                </span>
              ),
            }
          : number === undefined
            ? {
                id,
                get title() {
                  return ctx.t("panel.title")
                },
                closable: "compact",
                fallback: true,
              }
            : {
              id,
              title: `#${number}`,
              closable: "hover",
              label: (state) => (
                <span class="prr-tab-label" title={titles[prKey(state.session.directory, number)]}>
                  <ctx.ui.Icon name="github" size="small" />
                  <span>#{number}</span>
                  <Show when={titles[prKey(state.session.directory, number)]}>
                    {(title) => <span class="prr-tab-label-title">{title()}</span>}
                  </Show>
                </span>
              ),
            }
      tabs.set(id, tab)
      return tab
    }

    ctx.add(Panel, {
      id: "github",
      region: "side",
      wide: true,
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 60,
        kind: "menu",
        icon: "github",
      },
      list: (input) =>
        input.open.filter((id) => id === LIST_TAB || id === BRANCHES_TAB || prTabNumber(id) !== undefined).map(tabFor),
      render: (props) => (
        <Show
          when={prTabNumber(props.tab.id)}
          keyed
          fallback={
            <Show when={props.tab.id === BRANCHES_TAB} fallback={<ListView app={app} session={props.session} />}>
              <BranchesView app={app} session={props.session} />
            </Show>
          }
        >
          {(number) => <DetailView app={app} session={props.session} screen={props.screen} number={number} />}
        </Show>
      ),
    })

    ctx.add(
      MenuItem,
      (): MenuItem => {
        const session = ctx.sessions.current()
        return {
          menu: "session.panel",
          id: "open",
          title: ctx.t("menu.open"),
          icon: "github",
          keybind: `${ctx.id}.open`,
          opened: !!session && ctx.layout.state(listKey, session) !== "closed",
          run: () => {
            const s = ctx.sessions.current()
            if (s) app.openList(s)
          },
        }
      },
    )

    ctx.add(
      MenuItem,
      (): MenuItem => {
        const session = ctx.sessions.current()
        return {
          menu: "session.panel",
          id: "branches",
          title: ctx.t("menu.branches"),
          icon: "branch",
          keybind: `${ctx.id}.branches`,
          opened: !!session && ctx.layout.state(branchesKey, session) !== "closed",
          run: () => {
            const s = ctx.sessions.current()
            if (s) app.openBranches(s)
          },
        }
      },
    )

    // --- commands -----------------------------------------------------------------------------------------------------

    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command.open"),
        group: ctx.t("command.group"),
        keywords: "github pr pull request review",
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) app.openList(session)
        },
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "pick",
        title: ctx.t("command.pick"),
        group: ctx.t("command.group"),
        keywords: "github pr pull request review search",
        enabled: !!ctx.sessions.current(),
        run: async () => {
          const session = ctx.sessions.current()
          if (!session) return
          const loading = ctx.toast.show({ variant: "loading", title: "Loading pull requests…", persistent: true })
          try {
            const prs = await api.list(session.directory, "open")
            loading.dismiss()
            const number = await ctx.dialogs.select({
              title: ctx.t("command.pick"),
              placeholder: "Search pull requests",
              options: prs.map((pr) => ({
                title: `#${pr.number} ${pr.title}`,
                description: `${pr.author} · ${pr.head}`,
                value: pr.number,
                group: pr.reviewRequested ? "Needs your review" : undefined,
              })),
            })
            if (number !== undefined) app.openPr(session, number)
          } catch (error) {
            loading.dismiss()
            showErrorToast(ctx, "Loading pull requests", error, session.directory)
          }
        },
      }),
    )

    ctx.add(
      Command,
      (): Command => {
        const session = ctx.sessions.current()
        const pr = session ? current[session.directory] : undefined
        return {
          id: "current",
          title: ctx.t("command.current"),
          group: ctx.t("command.group"),
          keywords: "github pr branch",
          enabled: !!pr,
          run: () => {
            const s = ctx.sessions.current()
            const p = s ? current[s.directory] : undefined
            if (s && p) app.openPr(s, p.number)
          },
        }
      },
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "branches",
        title: ctx.t("command.branches"),
        group: ctx.t("command.group"),
        keywords: "git branch graph history commits",
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) app.openBranches(session)
        },
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "checkout",
        title: ctx.t("command.checkout"),
        group: ctx.t("command.group"),
        keywords: "git branch switch checkout",
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) void checkoutFlow(app, session)
        },
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "newBranch",
        title: ctx.t("command.newBranch"),
        group: ctx.t("command.group"),
        keywords: "git branch create new",
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) void newBranchFlow(app, session)
        },
      }),
    )

    // --- composer pills: PR for the session's current branch, and the branch itself --------------------------------

    const refreshCurrent = (session: SessionRef & { directory: string }) =>
      api.current(session.directory).then(
        (pr) => setCurrent(session.directory, pr),
        () => setCurrent(session.directory, null),
      )

    const refreshBranch = (session: SessionRef & { directory: string }) =>
      git.repo(session.directory).then(
        (status) => setBranch(session.directory, status),
        () => setBranch(session.directory, null),
      )

    createKeyed(
      () => `${ctx.sessions.current()?.directory}\n${branchTick()}`,
      () => {
        const session = ctx.sessions.current()
        if (!session) return
        void refreshCurrent(session)
        void refreshBranch(session)
        const timer = setInterval(() => {
          const s = ctx.sessions.current()
          if (s) {
            void refreshCurrent(s)
            void refreshBranch(s)
          }
        }, CURRENT_REFRESH_MS)
        onCleanup(() => clearInterval(timer))
      },
    )

    ctx.add(ComposerPill, {
      id: "branch",
      order: 5,
      show: (input) => {
        const status = branch[input.session.directory]
        if (!status) return undefined
        return {
          icon: "branch",
          label: status.detached ? `${status.hash} (detached)` : status.branch,
          title: `${ctx.t("pill.branch")}: ${status.detached ? `detached at ${status.hash}` : status.branch}`,
          rows: [
            {
              id: "open",
              label: "Open branches",
              icon: "branch",
              detail: status.detached ? "detached HEAD" : status.branch,
              run: () => app.openBranches(input.session),
            },
            {
              id: "checkout",
              label: "Checkout branch…",
              icon: "branch-out",
              run: () => void checkoutFlow(app, input.session),
            },
            {
              id: "new",
              label: "New branch…",
              icon: "plus",
              run: () => void newBranchFlow(app, input.session),
            },
          ],
        }
      },
    })

    ctx.add(ComposerPill, {
      id: "current",
      order: 10,
      show: (input) => {
        const pr = current[input.session.directory]
        if (!pr || pr.state !== "OPEN") return undefined
        return {
          icon: "github",
          label: `#${pr.number}`,
          title: `${ctx.t("pill.title")}: ${pr.title} — ${checkLabel(pr.checks)}`,
          tone: pr.checks === "failure" ? "danger" : pr.checks === "pending" ? "warning" : pr.checks === "success" ? "success" : undefined,
          rows: [
            {
              id: "open",
              label: `#${pr.number} ${pr.title}`,
              icon: "review",
              detail: "Open in sidebar",
              run: () => app.openPr(input.session, pr.number),
            },
            {
              id: "checks",
              label: checkLabel(pr.checks),
              icon: checkIcon(pr.checks),
              tone: pr.checks === "failure" ? "danger" : pr.checks === "success" ? "success" : undefined,
            },
            {
              id: "github",
              label: "Open on GitHub",
              icon: "square-arrow-top-right",
              run: () => ctx.system.openExternal(pr.url),
            },
          ],
        }
      },
    })
  },
})
