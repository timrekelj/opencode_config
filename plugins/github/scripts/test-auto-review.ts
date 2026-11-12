import { createdPr } from "../src/auto-review"

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `ok   ${name}` : `FAIL ${name}`, cond ? "" : JSON.stringify(extra))
  if (!cond) failures++
}

const url = "https://github.com/acme/widgets/pull/42"

const plain = createdPr("gh pr create --fill", `Creating pull request for x into main\n\n${url}\n`)
check("plain gh pr create", plain?.url === url && plain.number === 42, plain)

const chained = createdPr(
  'git push -u origin x && gh pr create --title "a" --body "b"',
  `remote: Create a pull request for 'x' on GitHub by visiting:\nremote:   https://github.com/acme/widgets/pull/new/x\nTo github.com:acme/widgets.git\n * [new branch] x -> x\n${url}\n`,
)
check("chained command with push noise", chained?.number === 42, chained)

const enterprise = createdPr("gh pr create --fill", "https://git.corp.example.com/team/app/pull/7\n")
check("GitHub Enterprise host", enterprise?.number === 7 && enterprise.url === "https://git.corp.example.com/team/app/pull/7", enterprise)

const multiple = createdPr("gh pr create --fill", "see https://github.com/acme/widgets/pull/1\nhttps://github.com/acme/widgets/pull/2\n")
check("multiple URLs use the last", multiple?.number === 2, multiple)

const exists = createdPr("gh pr create --fill", `a pull request for branch "x" into branch "main" already exists:\n${url}\n`)
check("already exists is ignored", exists === undefined, exists)

check("gh pr view is ignored", createdPr("gh pr view 12", `${url}\n`) === undefined)
check("--web without URL is ignored", createdPr("gh pr create --web", "Opening github.com/acme/widgets/pull/new/x in your browser.\n") === undefined)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
