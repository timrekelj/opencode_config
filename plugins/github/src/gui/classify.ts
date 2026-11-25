import type { IconName } from "@opencode/plugin/gui"
import { errorMessage } from "./api"

type ErrorKind =
  | "unavailable"
  | "git_missing"
  | "git_failed"
  | "not_git"
  | "unknown"

interface FriendlyError {
  kind: ErrorKind
  icon: IconName
  title: string
  hint: string
  command?: string
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
      title: "The github plugin's server part isn't running",
      hint: "The desktop panel loaded, but the OpenCode service hasn't loaded the plugin's server code yet. Restart the service, then retry.",
      command: "opencode service restart",
    }
  if (type === "git_failed") {
    if (/git was not found|command not found: git/i.test(raw))
      return {
        ...base,
        kind: "git_missing",
        icon: "console",
        title: "git isn't installed",
        hint: "This panel runs git on the machine running OpenCode. Install git, then retry.",
        command: "brew install git",
      }
    if (/not a git repository/i.test(raw))
      return {
        ...base,
        kind: "not_git",
        icon: "folder",
        title: "This folder isn't a git repository",
        hint: `Branches and history come from the session's folder${where}. Open a session inside a git repository.`,
        retry: false,
      }
    return {
      ...base,
      kind: "git_failed",
      icon: "circle-exclamation",
      title: "Git command failed",
      hint: "The details below show git's exact output.",
    }
  }
  return {
    ...base,
    kind: "unknown",
    icon: "circle-exclamation",
    title: "Something went wrong",
    hint: "The details below show the exact error.",
  }
}
