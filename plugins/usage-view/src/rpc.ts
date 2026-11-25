import { Rpc } from "@opencode/plugin/rpc"

const str = { type: "string" } as const
const num = { type: "number" } as const

const errors = { failed: { type: "object", properties: { message: str } } } as const

const modelRef = {
  type: "object",
  properties: { providerID: str, id: str },
  required: ["providerID", "id"],
} as const

const tokens = {
  type: "object",
  properties: {
    input: num,
    output: num,
    reasoning: num,
    cache: { type: "object", properties: { read: num, write: num } },
  },
} as const

const usageRanges = {
  type: "array",
  items: {
    type: "object",
    properties: {
      sessions: num,
      subagents: num,
      steps: num,
      cost: num,
      tokens,
      models: {
        type: "array",
        items: { type: "object", properties: { model: modelRef, steps: num, cost: num, tokens } },
      },
    },
  },
} as const

const modelUsage = {
  type: "array",
  items: { type: "object", properties: { model: modelRef, steps: num, cost: num, tokens } },
} as const

const toolTotals = {
  type: "object",
  properties: { calls: num, succeeded: num, failed: num, unfinished: num },
} as const

const sessionRanges = {
  type: "array",
  items: {
    type: "object",
    properties: {
      range: { type: "object", properties: { from: num, to: num } },
      sessions: num,
      subagents: num,
      prompts: num,
      steps: num,
      cost: num,
      tokens,
      models: modelUsage,
      activeDays: num,
      streak: num,
      activity: { type: "array", items: { type: "object", properties: { date: str, steps: num } } },
      tools: {
        type: "object",
        properties: {
          totals: toolTotals,
          usage: {
            type: "array",
            items: {
              type: "object",
              properties: { name: str, calls: num, succeeded: num, failed: num, unfinished: num, durationP50: num },
            },
          },
        },
      },
    },
  },
} as const

const limitsResult = {
  type: "object",
  properties: {
    checkedAt: num,
    providers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: ["claude", "codex", "opencode"] },
          label: str,
          account: str,
          error: str,
          resetCredits: num,
          manageUrl: str,
          resets: {
            type: "array",
            items: {
              type: "object",
              properties: { id: str, title: str, status: str, grantedAt: num, expiresAt: num },
              required: ["id", "status"],
            },
          },
          windows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: str,
                label: str,
                kind: { type: "string", enum: ["session", "weekly", "monthly", "other"] },
                usedPercent: num,
                resetsAt: num,
                windowDurationMins: num,
              },
              required: ["id", "label", "kind", "usedPercent"],
            },
          },
        },
        required: ["id", "label", "windows"],
      },
    },
  },
  required: ["checkedAt", "providers"],
} as const

export const UsageView = Rpc.define({
  id: "usage-view",
  methods: {
    prices: {
      input: {
        type: "object",
        properties: { models: { type: "array", items: modelRef }, refresh: { type: "boolean" } },
        required: ["models"],
      },
      output: {
        type: "object",
        properties: {
          fetchedAt: num,
          prices: {
            type: "object",
            additionalProperties: {
              anyOf: [
                {
                  type: "object",
                  properties: { input: num, output: num, cacheRead: num, cacheWrite: num, source: str },
                },
                { type: "null" },
              ],
            },
          },
        },
      },
      errors,
    },
    retained: {
      input: {
        type: "object",
        properties: {
          ranges: {
            type: "array",
            items: { type: "object", properties: { from: num, to: num }, required: ["to"] },
          },
          project: str,
        },
        required: ["ranges"],
      },
      output: {
        type: "object",
        properties: {
          earliest: num,
          ranges: usageRanges,
          adopted: usageRanges,
        },
      },
      errors,
    },
    session: {
      input: {
        type: "object",
        properties: {
          sessionID: str,
          ranges: {
            type: "array",
            items: { type: "object", properties: { from: num, to: num }, required: ["to"] },
          },
          timezone: str,
          tools: { type: "boolean" },
        },
        required: ["sessionID", "ranges"],
      },
      output: {
        type: "object",
        properties: { earliest: num, ranges: sessionRanges },
        required: ["ranges"],
      },
      errors,
    },
    daily: {
      input: {
        type: "object",
        properties: { from: num, to: num, project: str, session: str, timezone: str },
        required: ["from", "to"],
      },
      output: {
        type: "object",
        properties: {
          days: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: str,
                models: {
                  type: "array",
                  items: { type: "object", properties: { model: modelRef, steps: num, cost: num, tokens } },
                },
              },
              required: ["date", "models"],
            },
          },
        },
        required: ["days"],
      },
      errors,
    },
    limits: {
      input: {
        type: "object",
        properties: { refresh: { type: "boolean" } },
      },
      output: limitsResult,
      errors,
    },
    redeemReset: {
      input: {
        type: "object",
        properties: { provider: { type: "string", enum: ["codex"] }, creditId: str },
        required: ["provider", "creditId"],
      },
      output: limitsResult,
      errors,
    },
  },
  events: {},
})
