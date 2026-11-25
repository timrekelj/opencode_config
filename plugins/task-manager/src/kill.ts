/** Returns why a pid must not be signalled, or undefined when it is allowed. */
export function killGuard(pid: unknown, selfPid = process.pid, parentPid = process.ppid): string | undefined {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return "Invalid pid."
  if (pid <= 1) return "Refusing to signal pid 1 (launchd) or the kernel."
  if (pid === selfPid) return "Refusing to kill the OpenCode server, which is running this panel."
  if (pid === parentPid) return "Refusing to kill the parent of the OpenCode server."
  return undefined
}

export function killProcess(
  pid: unknown,
  force: boolean,
  signal: (pid: number, signal: NodeJS.Signals) => void = (p, s) => process.kill(p, s),
  selfPid = process.pid,
  parentPid = process.ppid,
): string {
  const refused = killGuard(pid, selfPid, parentPid)
  if (refused) throw new Error(refused)
  const target = pid as number
  const name = force ? "SIGKILL" : "SIGTERM"
  try {
    signal(target, name)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === "ESRCH") throw new Error(`Process ${target} no longer exists.`)
    if (code === "EPERM") throw new Error(`Not permitted to signal process ${target} (it belongs to another user or is protected).`)
    throw error
  }
  return `Sent ${name} to process ${target}.`
}
