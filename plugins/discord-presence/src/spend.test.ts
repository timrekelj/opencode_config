import { expect, test } from "bun:test"
import { formatSpend, modelsIn, spend, type DailyRows } from "./spend"

const tokens = (input: number, output = 0) => ({ input, output, reasoning: 0, cache: { read: 0, write: 0 } })
const price = { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 3, source: "test/x" }

test("price known: estimates from tokens, ignoring recorded cost", () => {
  const rows: DailyRows = {
    days: [{ models: [{ model: { providerID: "a", id: "m" }, cost: 99, tokens: { input: 1e6, output: 5e5, reasoning: 5e5, cache: { read: 2e6, write: 1e6 } } }] }],
  }
  // 1*2 + (0.5+0.5)*10 + 2*0.5 + 1*3
  expect(spend(rows, { "a/m": price })).toBeCloseTo(16)
})

test("price missing: falls back to the recorded cost", () => {
  const rows: DailyRows = { days: [{ models: [{ model: { providerID: "a", id: "m" }, cost: 1.25, tokens: tokens(1e6) }] }] }
  expect(spend(rows, { "a/m": null })).toBe(1.25)
  expect(spend(rows, {})).toBe(1.25)
})

test("sums several models across day rows", () => {
  const rows: DailyRows = {
    days: [
      { models: [{ model: { providerID: "a", id: "m" }, cost: 0, tokens: tokens(1e6) }, { model: { providerID: "b", id: "n" }, cost: 0.5, tokens: tokens(1e6) }] },
      { models: [{ model: { providerID: "a", id: "m" }, cost: 0, tokens: tokens(0, 1e6) }] },
    ],
  }
  expect(spend(rows, { "a/m": price })).toBeCloseTo(2 + 10 + 0.5)
  expect(modelsIn(rows)).toEqual([{ providerID: "a", id: "m" }, { providerID: "b", id: "n" }])
})

test("formatting", () => {
  expect(formatSpend(0)).toBe("Spent today: $0.00")
  expect(formatSpend(0.004)).toBe("Spent today: <$0.01")
  expect(formatSpend(4.2)).toBe("Spent today: $4.20")
  expect(formatSpend(1234.567)).toBe("Spent today: $1234.57")
})
