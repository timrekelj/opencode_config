import { Rpc } from "@opencode/plugin/rpc"

const str = { type: "string" } as const
const num = { type: "number" } as const
const bool = { type: "boolean" } as const
const any = { type: "object" } as const
const list = { type: "array" } as const

const input = <P extends Record<string, object>>(properties: P, required: (keyof P & string)[] = []) =>
  ({ type: "object", properties: { directory: str, ...properties }, required: ["directory", ...required] }) as const

const errors = {
  git_failed: { type: "object", properties: { message: str } },
} as const

const method = <I extends object, O extends object>(i: I, o: O) => ({ input: i, output: o, errors })

export const Git = Rpc.define({
  id: "github.git",
  methods: {
    repo: method(input({}), any),
    branches: method(input({}), list),
    graph: method(input({ scope: str, limit: num }), any),
    show: method(input({ hash: str }, ["hash"]), str),
    checkout: method(input({ ref: str }, ["ref"]), str),
    create: method(input({ name: str, start: str }, ["name"]), str),
    rename: method(input({ name: str, from: str }, ["name"]), str),
    delete: method(input({ name: str, force: bool }, ["name", "force"]), str),
    merge: method(input({ branch: str }, ["branch"]), str),
    fetch: method(input({}), str),
    pull: method(input({}), str),
    push: method(input({}), str),
  },
  events: {},
})
