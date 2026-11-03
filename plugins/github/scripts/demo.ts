// Scratch file for exercising the pull request panel. Safe to delete.
export function fib(n: number): number {
  if (n < 2) return n
  let a = 0
  let b = 1
  for (let i = 1; i < n; i++) [a, b] = [b, a + b]
  return b
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
