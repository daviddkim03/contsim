import { volume } from './geometry'
import { pack } from './packer'
import type { BoxType, Container, Objective, OptimizeResult, Ordering, PackResult } from './types'

export interface OptimizeProgress {
  runs: number
  maxRuns: number
  /** Boxes kept by the best plan so far. */
  bestKept: number
  requested: number
}

export interface OptimizeOptions {
  objective: Objective
  /** What the container may carry; 0 or missing means no limit. */
  maxWeight?: number
  /** Upper bound on packer runs. Default 200. */
  maxRuns?: number
  /** Called after every packer run. Return false to stop early with the best plan so far. */
  onProgress?: (progress: OptimizeProgress) => boolean | void
}

export const DEFAULT_MAX_RUNS = 200

/** Orderings tried in the multi-start phase; each yields a feasible partial plan. */
const START_ORDERINGS: Ordering[] = [
  'volume-desc',
  'volume-asc',
  'round-robin',
  'height-desc',
  'footprint-desc',
  { shuffle: 1 },
  { shuffle: 2 },
  { shuffle: 3 },
  { shuffle: 4 },
  { shuffle: 5 },
]

/** Orderings tried when checking whether a candidate plan fits completely. */
const TRIAL_ORDERINGS: Ordering[] = ['volume-desc', 'round-robin']

type Quantities = Record<string, number>

interface Plan {
  kept: Quantities
  /** A packing of exactly the kept quantities, status 'fits'. */
  result: PackResult
}

/**
 * Finds quantities k_i <= q_i that fit, removing as little as possible
 * according to the objective (PROJECT.md section 4.3).
 *
 * Every packer run yields a feasible reduced plan (the boxes it placed), so
 * the search is: try several orderings, keep the best plan, then greedily add
 * boxes back one at a time while the result still fits. `cut-evenly` instead
 * binary-searches the largest fraction f such that floor(f * q_i) fits, then
 * adds back. Deterministic for a given input and maxRuns.
 */
export function optimize(
  container: Container,
  types: BoxType[],
  options: OptimizeOptions,
): OptimizeResult {
  const start = performance.now()
  const maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS
  const active = types.filter((t) => t.qty > 0)
  const requested = Object.fromEntries(active.map((t) => [t.id, t.qty]))
  const requestedTotal = active.reduce((n, t) => n + t.qty, 0)
  const volumes = new Map(active.map((t) => [t.id, volume(t.dims)]))
  const typeIndex = new Map(active.map((t, i) => [t.id, i]))

  let runs = 0
  let stopped = false
  let best: Plan | null = null

  const total = (kept: Quantities) => active.reduce((n, t) => n + (kept[t.id] ?? 0), 0)
  const budgetLeft = () => !stopped && runs < maxRuns

  function run(kept: Quantities, order: Ordering, skipChecks: boolean): PackResult {
    runs++
    const result = pack(
      container,
      active.map((t) => ({ ...t, qty: kept[t.id] ?? 0 })),
      { maxWeight: options.maxWeight, order, skipChecks },
    )
    const report = options.onProgress?.({
      runs,
      maxRuns,
      bestKept: best ? total(best.kept) : 0,
      requested: requestedTotal,
    })
    if (report === false) stopped = true
    return result
  }

  const placedCounts = (result: PackResult): Quantities => {
    const counts: Quantities = Object.fromEntries(active.map((t) => [t.id, 0]))
    for (const p of result.placements) counts[p.typeId] = (counts[p.typeId] ?? 0) + 1
    return counts
  }

  /**
   * Turns quantities into a plan whose result has status 'fits'. Re-packing
   * the placed subset normally reproduces the same placements; when it does
   * not (seeded shuffles can reorder), the placed counts shrink and the loop
   * repeats, so it always terminates.
   */
  function settle(kept: Quantities, order: Ordering): Plan {
    for (;;) {
      const result = run(kept, order, false)
      if (result.status === 'fits') return { kept, result }
      const smaller = placedCounts(result)
      if (total(smaller) === total(kept)) {
        // Cannot happen (a full placement is 'fits'), but never loop forever.
        return { kept: smaller, result }
      }
      kept = smaller
    }
  }

  function score(plan: Plan): number[] {
    const count = total(plan.kept)
    const vol = active.reduce((v, t) => v + (plan.kept[t.id] ?? 0) * volumes.get(t.id)!, 0)
    const touched = active.filter((t) => (plan.kept[t.id] ?? 0) < t.qty).length
    const minRatio = Math.min(1, ...active.map((t) => (plan.kept[t.id] ?? 0) / t.qty))
    switch (options.objective) {
      case 'keep-most-boxes':
        return [count, vol, -touched]
      case 'keep-most-volume':
        return [vol, count, -touched]
      case 'cut-evenly':
        return [minRatio, count, vol]
    }
  }

  function better(candidate: Plan, incumbent: Plan | null): boolean {
    if (!incumbent) return true
    const a = score(candidate)
    const b = score(incumbent)
    for (let i = 0; i < a.length; i++) {
      if (a[i]! !== b[i]!) return a[i]! > b[i]!
    }
    return false
  }

  /** Which types to try adding a box back to first. */
  function addBackOrder(plan: Plan): BoxType[] {
    const byIndex = (a: BoxType, b: BoxType) => typeIndex.get(a.id)! - typeIndex.get(b.id)!
    const vol = (t: BoxType) => volumes.get(t.id)!
    const ratio = (t: BoxType) => (plan.kept[t.id] ?? 0) / t.qty
    const candidates = active.filter((t) => (plan.kept[t.id] ?? 0) < t.qty)
    switch (options.objective) {
      case 'keep-most-boxes':
        return candidates.sort((a, b) => vol(a) - vol(b) || byIndex(a, b))
      case 'keep-most-volume':
        return candidates.sort((a, b) => vol(b) - vol(a) || byIndex(a, b))
      case 'cut-evenly':
        return candidates.sort((a, b) => ratio(a) - ratio(b) || vol(a) - vol(b) || byIndex(a, b))
    }
  }

  const finish = (plan: Plan): OptimizeResult => {
    const removed: Quantities = {}
    for (const t of active) {
      const r = t.qty - (plan.kept[t.id] ?? 0)
      if (r > 0) removed[t.id] = r
    }
    return {
      kept: plan.kept,
      removed,
      result: plan.result,
      runs,
      ms: performance.now() - start,
    }
  }

  // 1. Maybe everything already fits.
  const full = run(requested, 'volume-desc', false)
  if (full.status === 'fits') return finish({ kept: requested, result: full })

  // 2. A first feasible plan, or several to choose from.
  if (options.objective === 'cut-evenly') {
    best = cutEvenly()
  } else {
    for (const order of START_ORDERINGS) {
      if (!budgetLeft()) break
      const partial = run(requested, order, true)
      if (!budgetLeft()) break
      const plan = settle(placedCounts(partial), order)
      if (better(plan, best)) best = plan
    }
  }
  if (!best) best = settle(placedCounts(full), 'volume-desc')

  // 3. Greedy add-back: return one removed box at a time while it still fits.
  let improved = true
  while (improved && budgetLeft()) {
    improved = false
    for (const t of addBackOrder(best)) {
      if (!budgetLeft()) break
      const trial: Quantities = { ...best.kept, [t.id]: (best.kept[t.id] ?? 0) + 1 }
      for (const order of TRIAL_ORDERINGS) {
        if (!budgetLeft()) break
        const result: PackResult = run(trial, order, false)
        if (result.status === 'fits') {
          best = { kept: trial, result }
          improved = true
          break
        }
      }
    }
  }

  return finish(best)

  /** Largest fraction f such that floor(f * q_i) of every type fits, by binary search. */
  function cutEvenly(): Plan {
    const fromFraction = (f: number): Quantities =>
      Object.fromEntries(active.map((t) => [t.id, Math.floor(f * t.qty)]))
    const key = (q: Quantities) => active.map((t) => q[t.id] ?? 0).join(',')
    let lo = 0
    let hi = 1
    let loKey = key(fromFraction(0))
    let hiKey = key(requested)
    let plan: Plan | null = null
    for (let i = 0; i < 24 && budgetLeft(); i++) {
      const mid = (lo + hi) / 2
      const kept = fromFraction(mid)
      const k = key(kept)
      if (k === loKey) {
        lo = mid
        continue
      }
      if (k === hiKey) {
        hi = mid
        continue
      }
      let fits: PackResult | null = null
      for (const order of TRIAL_ORDERINGS) {
        if (!budgetLeft()) break
        const result = run(kept, order, false)
        if (result.status === 'fits') {
          fits = result
          break
        }
      }
      if (fits) {
        lo = mid
        loKey = k
        plan = { kept, result: fits }
      } else {
        hi = mid
        hiKey = k
      }
    }
    return plan ?? settle(fromFraction(0), 'volume-desc')
  }
}
