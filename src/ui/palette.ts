/** Distinct, print-friendly colors for box types. */
export const PALETTE: readonly string[] = [
  '#f59e0b',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
]

/** The first palette color not yet in use, cycling when all are taken. */
export function nextColor(used: readonly string[]): string {
  const free = PALETTE.find((c) => !used.includes(c))
  return free ?? PALETTE[used.length % PALETTE.length]!
}
