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
          ranges: {
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
          },
        },
      },
      errors,
    },
    limits: {
      input: {
        type: "object",
        properties: { refresh: { type: "boolean" } },
      },
      output: {
        type: "object",
        properties: {
          checkedAt: num,
          providers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", enum: ["claude", "codex"] },
                label: str,
                account: str,
                error: str,
                resetCredits: num,
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
      },
      errors,
    },
  },
  events: {},
})
