import { spawn } from "node:child_process"

/** A failed spawn or non-zero exit; gh.ts and git.ts rewrap it as GhError / GitError. */
export class RunError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message)
  }
}

const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]

export interface RunOptions {
  cwd: string
  env?: Record<string, string>
  input?: string
  signal?: AbortSignal
}

export function run(bin: string, args: string[], options: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const path = [process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(":")
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PATH: path,
        NO_COLOR: "1",
        // Network commands (fetch, pull, push, gh pr checkout) must fail instead of hanging on a credential prompt.
        GIT_TERMINAL_PROMPT: "0",
        ...options.env,
      },
      signal: options.signal,
    })
    let out = ""
    let err = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => (out += chunk))
    child.stderr.on("data", (chunk: string) => (err += chunk))
    child.on("error", (error) =>
      reject(new RunError(error.message, (error as NodeJS.ErrnoException).code === "ENOENT")),
    )
    child.on("close", (code) => {
      if (code === 0) return resolve(out)
      reject(new RunError(err.trim() || out.trim() || `${bin} ${args[0]} exited with code ${code}`))
    })
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}
