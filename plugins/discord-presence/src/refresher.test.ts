import { expect, test } from "bun:test"
import { createSpendRefresher } from "./refresher"

const rows = { days: [{ date: "2026-11-19", models: [{ model: { providerID: "a", id: "m" }, steps: 1, cost: 4.2, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }] }] }

function setup(client: () => any) {
  const texts: (string | undefined)[] = []
  const logs: string[] = []
  const refresher = createSpendRefresher({
    rpc: () => (() => client()) as any,
    onText: (t) => void texts.push(t),
    log: (m) => void logs.push(m),
    now: () => new Date(2026, 10, 19, 15).getTime(),
    timezone: "UTC",
  })
  return { refresher, texts, logs }
}

test("publishes spend once and only when it changes", async () => {
  const calls: any[] = []
  const { refresher, texts } = setup(() => ({
    daily: async (input: any) => (calls.push(input), rows),
    prices: async () => ({ prices: { "a/m": null } }),
  }))
  await refresher.refresh()
  await refresher.refresh()
  expect(texts).toEqual(["Spent today: $4.20"])
  expect(calls[0]).toEqual({ from: new Date(2026, 10, 19).getTime(), to: new Date(2026, 10, 19, 15).getTime(), timezone: "UTC" })
})

test("coalesces concurrent refreshes", async () => {
  let n = 0
  const { refresher } = setup(() => ({ daily: async () => (n++, { days: [] }), prices: async () => ({ prices: {} }) }))
  await Promise.all([refresher.refresh(), refresher.refresh(), refresher.refresh()])
  expect(n).toBe(1)
})

test("rejecting rpc never throws and logs once per failure streak", async () => {
  let fail = true
  const { refresher, texts, logs } = setup(() => ({
    daily: async () => {
      if (fail) throw new Error("usage-view not loaded")
      return rows
    },
    prices: async () => ({ prices: {} }),
  }))
  await refresher.refresh()
  await refresher.refresh()
  expect(texts).toEqual([])
  expect(logs).toHaveLength(1)
  fail = false
  await refresher.refresh()
  expect(texts).toEqual(["Spent today: $4.20"])
  fail = true
  await refresher.refresh()
  expect(logs).toHaveLength(2)
})

test("a throwing client or missing context does not throw", async () => {
  const { refresher, logs } = setup(() => {
    throw new Error("boom")
  })
  await refresher.refresh()
  expect(logs).toHaveLength(1)
})
