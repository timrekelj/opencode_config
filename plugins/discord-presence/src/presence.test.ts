import { describe, expect, test } from "bun:test"
import { Presence, projectName } from "./presence"

const MIN = 60_000
const make = (idle = 15) =>
  new Presence({
    largeImage: "opencode",
    idleTimeoutMs: idle * MIN,
    modelName: (m) => (m.id === "opus" ? "Claude Opus" : undefined),
  })

describe("presence", () => {
  test("nothing known means no activity", () => {
    expect(make().activity(0)).toBeNull()
  })

  test("project name is the basename of the directory", () => {
    expect(projectName("/a/b/my-app/")).toBe("my-app")
    expect(projectName(undefined)).toBeUndefined()
  })

  test("working, then idle, with model name and timestamps", () => {
    const p = make()
    p.apply({ type: "started", sessionID: "s1", at: 1000, directory: "/w/app", model: { id: "opus" } })
    expect(p.activity(2000)).toEqual({
      details: "app",
      state: "Working · Claude Opus",
      timestamps: { start: 1000 },
      assets: { large_image: "opencode", large_text: "OpenCode" },
    })
    p.apply({ type: "ended", sessionID: "s1", at: 5000 })
    const idle = p.activity(6000)!
    expect(idle.state).toBe("Idle · Claude Opus")
    expect(idle.timestamps.start).toBe(1000)
    p.apply({ type: "started", sessionID: "s1", at: 7000 })
    expect(p.activity(8000)!.timestamps.start).toBe(1000)
  })

  test("falls back to the model id", () => {
    const p = make()
    p.apply({ type: "started", sessionID: "s1", at: 1, directory: "/w/app", model: { id: "other" } })
    expect(p.activity(2)!.state).toBe("Working · other")
  })

  test("two sessions: stays working until both finish, start time is kept", () => {
    const p = make()
    p.apply({ type: "started", sessionID: "a", at: 1000, directory: "/w/one", model: { id: "m1" } })
    p.apply({ type: "started", sessionID: "b", at: 2000, directory: "/w/two", model: { id: "m2" } })
    let a = p.activity(3000)!
    expect(a.details).toBe("two, one")
    expect(a.state).toBe("Working · m2")
    expect(a.timestamps.start).toBe(1000)
    p.apply({ type: "ended", sessionID: "b", at: 4000 })
    a = p.activity(4500)!
    expect(a.state.startsWith("Working")).toBe(true)
    expect(a.timestamps.start).toBe(1000)
    p.apply({ type: "deleted", sessionID: "a", at: 5000 })
    a = p.activity(5500)!
    expect(a.state.startsWith("Idle")).toBe(true)
    expect(a.timestamps.start).toBe(1000)
  })

  test("deleting every session starts a fresh timer on the next start", () => {
    const p = make()
    p.apply({ type: "started", sessionID: "a", at: 1000, directory: "/w/one" })
    p.apply({ type: "deleted", sessionID: "a", at: 2000 })
    expect(p.activity(2500)).toBeNull()
    p.apply({ type: "started", sessionID: "b", at: 3000, directory: "/w/two" })
    expect(p.activity(3500)!.timestamps.start).toBe(3000)
  })

  test("model selection updates the model", () => {
    const p = make()
    p.apply({ type: "started", sessionID: "s", at: 1, directory: "/w/app", model: { id: "m1" } })
    p.apply({ type: "model", sessionID: "s", at: 2, model: { id: "opus" } })
    expect(p.activity(3)!.state).toBe("Working · Claude Opus")
  })

  describe("details", () => {
    const busy = (p: Presence, id: string, dir: string, at: number) =>
      p.apply({ type: "started", sessionID: id, at, directory: dir })

    test("one busy project", () => {
      const p = make()
      busy(p, "a", "/w/app", 1)
      expect(p.activity(2)!.details).toBe("app")
    })

    test("two busy projects, most recent first", () => {
      const p = make()
      busy(p, "a", "/w/one", 1)
      busy(p, "b", "/w/two", 2)
      expect(p.activity(3)!.details).toBe("two, one")
    })

    test("same project in two sessions is listed once", () => {
      const p = make()
      busy(p, "a", "/w/one", 1)
      busy(p, "b", "/w/two", 2)
      busy(p, "c", "/x/one", 3)
      expect(p.activity(4)!.details).toBe("one, two")
    })

    test("overflow collapses into +N within the limit", () => {
      const p = make()
      for (const [i, name] of ["alpha", "beta", "gamma", "opencode", "weekendr-backend"].entries()) busy(p, name, `/w/${name}`, i + 1)
      const details = p.activity(10)!.details
      expect(details).toBe("weekendr-backend, opencode +3")
      expect(details.length).toBeLessThanOrEqual(32)
    })

    test("a single over-long name is truncated", () => {
      const p = make()
      busy(p, "a", "/w/" + "x".repeat(50), 1)
      const details = p.activity(2)!.details
      expect(details).toBe("x".repeat(31) + "…")
      // The long name leads and the others collapse into the suffix.
      busy(p, "b", "/w/other", 3)
      busy(p, "c", "/w/" + "y".repeat(50), 4)
      expect(p.activity(5)!.details).toBe("y".repeat(28) + "… +2")
    })

    test("idle falls back to the most recent project", () => {
      const p = make()
      busy(p, "a", "/w/one", 1)
      busy(p, "b", "/w/two", 2)
      p.apply({ type: "ended", sessionID: "a", at: 3 })
      p.apply({ type: "ended", sessionID: "b", at: 4 })
      expect(p.activity(5)!.details).toBe("two")
    })

    test("custom maxDetailsLength", () => {
      const p = new Presence({ largeImage: "opencode", idleTimeoutMs: MIN, maxDetailsLength: 12 })
      busy(p, "a", "/w/alpha", 1)
      busy(p, "b", "/w/beta", 2)
      busy(p, "c", "/w/gamma", 3)
      expect(p.activity(4)!.details).toBe("gamma +2")
      const wide = new Presence({ largeImage: "opencode", idleTimeoutMs: MIN, maxDetailsLength: 500 })
      busy(wide, "a", "/w/" + "n".repeat(300), 1)
      expect(wide.activity(2)!.details.length).toBe(128)
    })
  })

  test("idle timeout clears the activity, new events bring it back", () => {
    const p = make(15)
    p.apply({ type: "started", sessionID: "s", at: 0, directory: "/w/app" })
    p.apply({ type: "ended", sessionID: "s", at: 1000 })
    expect(p.expiresAt()).toBe(1000 + 15 * MIN)
    expect(p.activity(1000 + 15 * MIN - 1)).not.toBeNull()
    expect(p.activity(1000 + 15 * MIN)).toBeNull()
    p.apply({ type: "started", sessionID: "s", at: 20 * MIN })
    expect(p.activity(20 * MIN + 1)!.state).toBe("Working")
    expect(p.activity(20 * MIN + 1)!.timestamps.start).toBe(20 * MIN)
    expect(p.expiresAt()).toBeUndefined()
  })

  test("large image text shows the spend when set, OpenCode otherwise", () => {
    const p = make()
    p.apply({ type: "started", sessionID: "s1", at: 1000, directory: "/w/app" })
    expect(p.activity(2000)!.assets.large_text).toBe("OpenCode")
    p.setSpend("Spent today: $4.20")
    expect(p.activity(2000)!.assets.large_text).toBe("Spent today: $4.20")
    p.setSpend(undefined)
    expect(p.activity(2000)!.assets.large_text).toBe("OpenCode")
  })
})
