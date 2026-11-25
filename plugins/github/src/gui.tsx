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
import { createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { RepoStatus } from "./types"
import { makeGitApi } from "./gui/api"
import { BRANCHES_TAB, type App } from "./gui/app"
import { BranchesView, checkoutFlow, newBranchFlow } from "./gui/branches"
import css from "./gui/style.css?inline"

const BRANCH_REFRESH_MS = 3000

export default Plugin.define({
  i18n: {
    en: {
      "panel.branches": "Branches",
      "command.branches": "Open branches",
      "command.checkout": "Checkout branch…",
      "command.newBranch": "New branch…",
      "command.group": "GitHub",
      "menu.branches": "Branches",
      "pill.branch": "Current branch",
    },
  },
  setup(ctx) {
    const git = makeGitApi(ctx)
    const [branch, setBranch] = createStore<Record<string, RepoStatus | null>>({})
    const [branchTick, setBranchTick] = createSignal(0)

    const branchesKey = `${ctx.id}:${BRANCHES_TAB}`

    const optionLimit = Number(ctx.options.limit)

    const app: App = {
      ctx,
      git,
      graphLimit: Number.isFinite(optionLimit) && optionLimit > 0 ? optionLimit : 300,
      openBranches: (session) => ctx.layout.open(branchesKey, session, { tab: "select" }),
      branchTick,
      bumpBranch: () => setBranchTick((v) => v + 1),
    }

    ctx.add(Style, css)

    // --- panel tabs ---------------------------------------------------------------------------------------------------

    const branchesTab: PanelTab = {
      id: BRANCHES_TAB,
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

    ctx.add(Panel, {
      id: "github",
      region: "side",
      wide: true,
      mobile: {
        get title() {
          return ctx.t("panel.branches")
        },
        order: 60,
        kind: "menu",
        icon: "github",
      },
      list: (input) => input.open.filter((id) => id === BRANCHES_TAB).map(() => branchesTab),
      render: (props) => <BranchesView app={app} session={props.session} />,
    })

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

    // --- composer pill: the session's current branch -------------------------------------------------------------

    // Latest request per directory wins, so a slow response can't overwrite a newer one.
    const branchSeq: Record<string, number> = {}
    const refreshBranch = (session: SessionRef & { directory: string }) => {
      const dir = session.directory
      const seq = (branchSeq[dir] = (branchSeq[dir] ?? 0) + 1)
      return git.repo(dir).then(
        (status) => {
          if (branchSeq[dir] !== seq) return
          setBranch(dir, status)
        },
        () => branchSeq[dir] === seq && setBranch(dir, null),
      )
    }

    createKeyed(
      () => `${ctx.sessions.current()?.directory}\n${branchTick()}`,
      () => {
        const session = ctx.sessions.current()
        if (!session) return
        void refreshBranch(session)
        // Reading the branch is a few local git calls, so poll it often while the window is visible.
        const branchTimer = setInterval(() => {
          const s = ctx.sessions.current()
          if (s && document.visibilityState === "visible") void refreshBranch(s)
        }, BRANCH_REFRESH_MS)
        const onFocus = () => {
          const s = ctx.sessions.current()
          if (s && document.visibilityState === "visible") void refreshBranch(s)
        }
        window.addEventListener("focus", onFocus)
        document.addEventListener("visibilitychange", onFocus)
        onCleanup(() => {
          clearInterval(branchTimer)
          window.removeEventListener("focus", onFocus)
          document.removeEventListener("visibilitychange", onFocus)
        })
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
  },
})
