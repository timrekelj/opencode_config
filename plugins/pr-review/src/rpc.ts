import { Rpc } from "@opencode/plugin/rpc"

const str = { type: "string" } as const
const num = { type: "number" } as const
const bool = { type: "boolean" } as const
const any = { type: "object" } as const
const list = { type: "array" } as const
const nullable = {} as const

const input = <P extends Record<string, object>>(properties: P, required: (keyof P & string)[] = []) =>
  ({ type: "object", properties: { directory: str, ...properties }, required: ["directory", ...required] }) as const

const errors = { gh_failed: { type: "object", properties: { message: str } } } as const

const method = <I extends object, O extends object>(i: I, o: O) => ({ input: i, output: o, errors })

export const PrReview = Rpc.define({
  id: "pr-review",
  methods: {
    repo: method(input({}), any),
    list: method(input({ state: str }), list),
    detail: method(input({ number: num }, ["number"]), any),
    files: method(input({ number: num }, ["number"]), any),
    current: method(input({}), nullable),
    setViewed: method(input({ number: num, path: str, viewed: bool }, ["number", "path", "viewed"]), nullable),
    comment: method(input({ number: num, body: str }, ["number", "body"]), nullable),
    reply: method(input({ number: num, commentID: num, body: str }, ["number", "commentID", "body"]), nullable),
    submitReview: method(
      input({ number: num, event: str, body: str, commit: str, comments: list }, ["number", "event", "commit"]),
      nullable,
    ),
    merge: method(input({ number: num, method: str }, ["number", "method"]), nullable),
    checkout: method(input({ number: num }, ["number"]), nullable),
    ready: method(input({ number: num }, ["number"]), nullable),
  },
  events: {},
})
