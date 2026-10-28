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
