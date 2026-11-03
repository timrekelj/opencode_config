// Scratch file for exercising the pull request panel. Safe to delete.
export function fib(n: number): number {
  if (n < 2) return n
  return fib(n - 1) + fib(n - 2)
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
