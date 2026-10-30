export interface ModelKey {
  providerID: string
  id: string
}

/** USD per million tokens. `source` is the models.dev entry used, as `provider/model`. */
export interface Price {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  source: string
}

export interface PricesResult {
  fetchedAt: number
  /** Keyed by `providerID/id`; null when models.dev has no price for the model. */
  prices: Record<string, Price | null>
}

export interface TokenTotals {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface RetainedModel {
  model: ModelKey
  steps: number
  cost: number
  tokens: TokenTotals
}

/** Usage of deleted sessions in one time range. */
export interface RetainedRange {
  sessions: number
  subagents: number
  steps: number
  cost: number
  tokens: TokenTotals
  models: RetainedModel[]
}

export interface RetainedResult {
  /** Earliest retained usage in scope, if any. */
  earliest?: number
  ranges: RetainedRange[]
}

export const modelKey = (model: ModelKey) => `${model.providerID}/${model.id}`

export interface LimitWindow {
  id: string
  label: string
  kind: "session" | "weekly" | "monthly" | "other"
  /** Percentage of the window used, 0-100, as reported by the provider. */
  usedPercent: number
  /** Epoch ms when the window resets, if the provider reports it. */
  resetsAt?: number
  windowDurationMins?: number
}

export interface LimitProvider {
  id: "claude" | "codex"
  label: string
  /** Plan or account label, if known. Never includes tokens or emails. */
  account?: string
  windows: LimitWindow[]
  /** Set when the provider could not be reached or is not signed in. */
  error?: string
  /** Banked rate-limit reset credits (Codex), if reported. */
  resetCredits?: number
}

export interface LimitsResult {
  checkedAt: number
  providers: LimitProvider[]
}
