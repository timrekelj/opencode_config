import type { Context, SessionRef } from "@opencode/plugin/gui"
import type { DraftComment } from "../types"
import type { Api } from "./api"

export const LIST_TAB = "list"
export const prTabId = (number: number) => `pr-${number}`
export const prTabNumber = (id: string) => (/^pr-(\d+)$/.exec(id) ? Number(id.slice(3)) : undefined)

export interface App {
  ctx: Context
  api: Api
  drafts: Record<string, DraftComment[]>
  updateDrafts(key: string, fn: (list: DraftComment[]) => DraftComment[]): void
  titles: Record<string, string>
  setTitle(key: string, title: string): void
  openList(session: SessionRef): void
  openPr(session: SessionRef, number: number): void
}

export const prKey = (directory: string, number: number) => `${directory}#${number}`
