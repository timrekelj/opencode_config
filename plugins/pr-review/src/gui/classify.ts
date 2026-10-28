import type { IconName } from "@opencode/plugin/gui"
import { errorMessage } from "./api"

export type ErrorKind =
  | "unavailable"
  | "gh_missing"
  | "gh_auth"
  | "not_git"
  | "no_remote"
  | "not_github"
  | "not_found"
  | "rate_limit"
  | "network"
  | "unknown"

export interface FriendlyError {
  kind: ErrorKind
  icon: IconName
  title: string
  hint: string
  command?: string
  link?: { label: string; url: string }
  retry: boolean
  raw: string
}

const errorType = (error: unknown) =>
  typeof error === "object" && error && typeof (error as { type?: unknown }).type === "string"
    ? (error as { type: string }).type
    : undefined

export function describeError(error: unknown, directory?: string): FriendlyError {
  const raw = errorMessage(error)
  const type = errorType(error)
  const where = directory ? ` (${directory})` : ""
  const base = { raw, retry: true }

  if (type === "rpc.unavailable" || /RPC is unavailable|method_not_found/i.test(raw))
    return {
      ...base,
      kind: "unavailable",
      icon: "extensions",
      title: "The PR plugin's server part isn't running",
      hint: "The desktop panel loaded, but the OpenCode service hasn't loaded the plugin's server code yet. Restart the service, then retry.",
      command: "opencode service restart",
    }
  if (/gh\) was not found|command not found: gh|ENOENT/i.test(raw))
    return {
      ...base,
      kind: "gh_missing",
      icon: "console",
      title: "GitHub CLI isn't installed",
      hint: "This panel uses the GitHub CLI (gh) on the machine running OpenCode. Install it, sign in, then retry.",
      command: "brew install gh && gh auth login",
      link: { label: "cli.github.com", url: "https://cli.github.com" },
    }
  if (/not a github|unable to determine.*host|known github host|none of the git remotes configured/i.test(raw))
    return {
      ...base,
      kind: "not_github",
      icon: "github",
      title: "Not a GitHub repository",
      hint: "This repository's remotes don't point to GitHub. Only GitHub pull requests are supported.",
      retry: false,
    }
  if (/gh auth login|not logged in|authentication required|HTTP 401|bad credentials|token .*(expired|invalid)/i.test(raw))
    return {
      ...base,
      kind: "gh_auth",
      icon: "lock",
      title: "Sign in to the GitHub CLI",
      hint: "gh isn't authenticated, or its token expired. Sign in from a terminal, then retry.",
      command: "gh auth login",
    }
  if (/not a git repository/i.test(raw))
    return {
      ...base,
      kind: "not_git",
      icon: "folder",
      title: "This folder isn't a git repository",
      hint: `Pull requests come from the session's folder${where}. Open a session inside a GitHub repository to review its pull requests.`,
      retry: false,
    }
  if (/no git remotes|none of the git remotes|could not find any remote|no remote/i.test(raw))
    return {
      ...base,
      kind: "no_remote",
      icon: "branch",
      title: "This repository has no GitHub remote",
      hint: `The repository${where} has no remote that points to GitHub. Add one, then retry.`,
      command: "git remote add origin git@github.com:OWNER/REPO.git",
    }
  if (/rate limit|abuse detection|secondary rate/i.test(raw))
    return {
      ...base,
      kind: "rate_limit",
      icon: "status",
      title: "GitHub rate limit reached",
      hint: "GitHub is limiting requests for your account. Wait a few minutes, then retry.",
    }
  if (/HTTP 5\d\d|bad gateway|service unavailable|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|could not resolve host|network/i.test(raw))
    return {
      ...base,
      kind: "network",
      icon: "globe",
      title: "Couldn't reach GitHub",
      hint: "GitHub didn't respond (it may be busy, or you may be offline). Retry in a moment.",
      link: { label: "githubstatus.com", url: "https://www.githubstatus.com" },
    }
  if (/could not resolve to a pullrequest|no pull requests? found|HTTP 404|not found/i.test(raw))
    return {
      ...base,
      kind: "not_found",
      icon: "circle-ban-sign",
      title: "Not found on GitHub",
      hint: "It may have been deleted, or you may not have access to this repository.",
    }
  return {
    ...base,
    kind: "unknown",
    icon: "circle-exclamation",
    title: "Something went wrong",
    hint: "The GitHub CLI returned an error. The details below show its exact output.",
  }
}
