import { execFile } from "node:child_process"

/** Runs a binary without a shell and resolves with its stdout. */
export const run = (file: string, args: string[], timeout = 8000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
