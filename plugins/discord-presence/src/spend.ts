// Pure spend calculation: usage-view's daily rows plus prices in, today's estimated API cost out. No IO.
import { UsageView } from "../../usage-view/src/rpc"
import { modelKey, type ModelKey, type Price } from "../../usage-view/src/types"
import { estimate, type Tokens } from "../../usage-view/src/gui/format"

export type DailyRows = {
  days: { models: { model: ModelKey; cost: number; tokens: Tokens }[] }[]
}

/** Every distinct model in the rows, for the `prices` call. */
export function modelsIn(rows: DailyRows): ModelKey[] {
  const models = new Map<string, ModelKey>()
  for (const day of rows.days) {
    for (const m of day.models) models.set(modelKey(m.model), { providerID: m.model.providerID, id: m.model.id })
  }
  return [...models.values()]
}

/**
 * Estimated API cost in USD, as usage-view's "Estimated cost" (see its README, "How cost is estimated"): per model the
 * token estimate at the models.dev price, or the model's recorded cost when no price is known.
 */
export function spend(rows: DailyRows, prices: Record<string, Price | null | undefined>): number {
  let total = 0
  for (const day of rows.days) {
    for (const m of day.models) total += estimate(m.tokens, prices[modelKey(m.model)]) ?? m.cost
  }
  return total
}

export function formatSpend(value: number): string {
  if (value > 0 && value < 0.01) return "Spent today: <$0.01"
  return `Spent today: $${Math.max(0, value).toFixed(2)}`
}

export { UsageView }
