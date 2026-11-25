import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTrace } from "./trace"

test("appends one JSON line per call, creating directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpt-"))
  try {
    const path = join(dir, "a", "b", "x.log")
    const trace = createTrace(path, 42)
    trace("shown")
    trace("cleared", "idle")
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(lines.map((l) => [l.pid, l.kind, l.reason])).toEqual([[42, "shown", undefined], [42, "cleared", "idle"]])
    expect(new Date(lines[0].time).toISOString()).toBe(lines[0].time)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("never throws on an unwritable path", () => {
  expect(() => createTrace("/dev/null/nope/x.log")("shown")).not.toThrow()
})
