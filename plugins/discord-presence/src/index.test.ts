import { expect, test } from "bun:test"
import plugin from "./index"

test("empty clientId is a no-op warning", async () => {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (m: string) => void warnings.push(m)
  try {
    const cleanup = await plugin.setup({ options: { clientId: "" } } as any)
    expect(cleanup).toBeUndefined()
  } finally {
    console.warn = original
  }
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("clientId")
})

test("setup survives usage-view being unavailable (rpc rejects) and warns once", async () => {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (m: string) => void warnings.push(m)
  const never = { async *[Symbol.asyncIterator]() {} }
  const ctx = {
    options: { clientId: "1" },
    model: { list: async () => ({ data: [] }) },
    event: { subscribe: () => never },
    rpc: () => ({
      daily: async () => {
        throw new Error("usage-view not loaded")
      },
      prices: async () => ({ prices: {} }),
    }),
  }
  try {
    const cleanup = await plugin.setup(ctx as any)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(warnings.filter((w) => w.includes("spend unavailable"))).toHaveLength(1)
    await (cleanup as () => unknown)()
  } finally {
    console.warn = original
  }
})
