import { describe, expect, test } from "bun:test"
import { alertsFor, parseThresholds } from "../src/gui/alerts"
import type { LimitsResult } from "../src/types"

const result = (used: number[], extra: Partial<LimitsResult["providers"][number]> = {}): LimitsResult => ({
  checkedAt: 0,
  providers: [
    {
      id: "claude",
      label: "Claude Code",
      windows: used.map((usedPercent, i) => ({ id: `w${i}`, label: i ? "weekly" : "5-hour session", kind: i ? "weekly" : "session", usedPercent, resetsAt: Date.now() + 3 * 3600_000 })),
      ...extra,
    },
  ],
})

describe("limit alerts", () => {
  test("thresholds", () => {
    expect(parseThresholds(undefined)).toEqual([80, 95])
    expect(parseThresholds(90)).toEqual([90])
    expect(parseThresholds([95, 70, 70, "x", 120])).toEqual([70, 95])
    expect(parseThresholds(false)).toEqual([])
  })

  test("warns once per window at the highest threshold crossed", () => {
    const alerts = alertsFor(result([50, 82, 97]), [80, 95])
    expect(alerts.map((a) => a.key.split(":").slice(0, 2).join(":") + ":" + a.key.split(":").at(-1))).toEqual(["claude:w1:80", "claude:w2:95"])
    expect(alerts[0]!.title).toBe("Claude Code: 82% of weekly used")
    expect(alerts[0]!.description).toMatch(/^18% left, resets in [23]h\.$/)
    expect(alerts[0]!.danger).toBe(false)
    expect(alerts[1]!.danger).toBe(true)
  })

  test("a new reset time gives a new key; errors are ignored", () => {
    const a = alertsFor(result([85]), [80])[0]!.key
    const later = result([85])
    later.providers[0]!.windows[0]!.resetsAt = Date.now() + 8 * 3600_000
    expect(alertsFor(later, [80])[0]!.key).not.toBe(a)
    expect(alertsFor(result([99], { error: "not signed in" }), [80])).toEqual([])
  })
})
