/**
 * Packing into as many containers of one size as it takes, in one of two
 * modes (PROJECT.md section 4.4).
 *
 * - 'even' spreads the load: it first sees how many containers are needed,
 *   then gives each one its share of every box type, so the containers hold
 *   close to the same number of boxes. It never uses more containers than
 *   filling them one at a time would.
 * - 'optimize' fills each container as full as it can before opening the
 *   next, with the optimizer (section 4.3) when it is given a budget. The
 *   last container is then often nearly empty.
 *
 * Both are deterministic. A box type that fits in no container in any allowed
 * orientation can never ship in this container size; the result says so
 * (status 'impossible') and still packs everything else.
 */

import { boxWeight, insideContainer, orientations, volume } from './geometry'
import { optimize } from './optimizer'
import { pack } from './packer'
import type { BoxType, Container, Impossibility, PackResult } from './types'
import { validateScenario } from './validate'

/** How the boxes are spread over the containers; see the note at the top. */
export type LoadMode = 'even' | 'optimize'

export type MultiStatus = 'fits' | 'impossible' | 'limit'

export interface MultiPackStats {
  containers: number
  requested: number
  placed: number
  /** Weight loaded over all containers; 0 when no box has one. */
  weight: number
  /** What one container may carry; 0 when there is no limit. */
  maxWeight: number
  /** Interior volume of one container. */
  containerVolume: number
  /** Over all containers. */
  placedVolume: number
  /** placedVolume over the volume of all opened containers; 0 when none were opened. */
  fill: number
  ms: number
}

export interface MultiPackResult {
  /**
   * - fits: every requested box is in some container.
   * - impossible: some type fits in no container at all (see impossibility); the rest is packed.
   * - limit: the container cap was reached; the rest is reported unplaced.
   */
  status: MultiStatus
  impossibility?: Impossibility
  /** One packing per container in fill order, each with status 'fits' for the boxes it holds. */
  containers: PackResult[]
  /** typeId -> boxes that are in no container. */
  unplaced: Record<string, number>
  stats: MultiPackStats
  /** Packer runs used. */
  runs: number
}

export interface MultiPackProgress {
  runs: number
  maxRuns: number
  /** Containers finished so far. */
  containers: number
  placed: number
  requested: number
}

export interface MultiPackOptions {
  keepUpright: boolean
  /** Default 'optimize', which is what the packer did before modes existed. */
  mode?: LoadMode
  /**
   * Boxes of a type the caller wants in a given container, by container index
   * then type id. A count caps what that container is offered, so lowering it
   * pushes the rest into later containers and raising it pulls them back; what
   * does not fit still rolls on, so a container never holds more than it can.
   */
  allocation?: readonly (Record<string, number> | undefined)[]
  /** What one container may carry, in the same unit as BoxType.weight. 0 for no limit. */
  maxWeight?: number
  /** Never open more than this many containers. Default 50. */
  maxContainers?: number
  /**
   * Packer-run budget for the optimizer across all containers, in 'optimize'
   * mode. 0 (default) packs every container once, first fit; that takes a few
   * milliseconds. 'even' mode never optimizes and ignores this.
   */
  optimizeRuns?: number
  /**
   * Wall-clock budget for the optimizing, in milliseconds. A run costs
   * anything from a fraction of a millisecond to tens of them depending on
   * how many boxes share a container, so the run count alone is a poor
   * bound. Past the budget the remaining containers are packed first fit.
   * Default DEFAULT_OPTIMIZE_MS; pass Infinity to bound by runs alone.
   */
  budgetMs?: number
  /** Called after every optimizer run. Return false to finish without further optimizing. */
  onProgress?: (progress: MultiPackProgress) => boolean | void
}

export const DEFAULT_MAX_CONTAINERS = 50
export const DEFAULT_OPTIMIZE_RUNS = 400
/** Long enough to improve a load, short enough to leave the machine alone. */
export const DEFAULT_OPTIMIZE_MS = 1500

type Quantities = Record<string, number>

const sum = (q: Quantities) => Object.values(q).reduce((a, b) => a + b, 0)

/** The packer's partial result as the complete packing of exactly the boxes it placed. */
function asOwnPacking(result: PackResult): PackResult {
  return {
    status: 'fits',
    placements: result.placements,
    unplaced: {},
    stats: { ...result.stats, requested: result.stats.placed },
  }
}

/**
 * One container's share of what is left, so that every container ends up with
 * about the same number of boxes and the same mix of types. Whole boxes are
 * handed out by largest remainder, which keeps the split deterministic.
 */
export function evenShare(
  types: readonly BoxType[],
  remaining: Quantities,
  containersLeft: number,
): Quantities {
  const total = sum(remaining)
  const share: Quantities = {}
  if (containersLeft <= 1 || total === 0) {
    for (const t of types) share[t.id] = remaining[t.id] ?? 0
    return share
  }
  const target = Math.ceil(total / containersLeft)
  const parts: { id: string; fraction: number }[] = []
  let given = 0
  for (const t of types) {
    const have = remaining[t.id] ?? 0
    const exact = (have * target) / total
    const whole = Math.floor(exact)
    share[t.id] = whole
    given += whole
    if (whole < have) parts.push({ id: t.id, fraction: exact - whole })
  }
  parts.sort((a, b) => b.fraction - a.fraction)
  for (const part of parts) {
    if (given >= target) break
    share[part.id]!++
    given++
  }
  return share
}

export function packMany(
  container: Container,
  types: BoxType[],
  options: MultiPackOptions,
): MultiPackResult {
  const start = performance.now()
  const issues = validateScenario(container, types)
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.path} ${i.message}`).join('; ')
    throw new Error(`Invalid scenario: ${detail}`)
  }
  const mode = options.mode ?? 'optimize'
  const maxWeight = options.maxWeight ?? 0
  const maxContainers = options.maxContainers ?? DEFAULT_MAX_CONTAINERS
  const maxRuns = options.optimizeRuns ?? 0
  const budgetMs = options.budgetMs ?? DEFAULT_OPTIMIZE_MS
  const requested = types.reduce((n, t) => n + t.qty, 0)
  const containerVolume = volume(container)

  const unplaced: Quantities = {}
  let impossibility: Impossibility | undefined
  const packable: BoxType[] = []
  for (const t of types) {
    if (t.qty === 0) continue
    const origin = { x: 0, y: 0, z: 0 }
    const fitsAlone = orientations(t.dims, options.keepUpright).some((s) =>
      insideContainer(origin, s, container),
    )
    const weight = boxWeight(t)
    const tooHeavy = maxWeight > 0 && weight > maxWeight
    if (fitsAlone && !tooHeavy) packable.push(t)
    else {
      unplaced[t.id] = t.qty
      impossibility ??= tooHeavy
        ? { kind: 'overweight', typeId: t.id, weight, maxWeight }
        : { kind: 'oversize', typeId: t.id }
    }
  }

  const requestedOf: Quantities = Object.fromEntries(packable.map((t) => [t.id, t.qty]))
  let runs = 0
  let optimizing = mode === 'optimize' && maxRuns > 0

  const report = (containersDone: number, placed: number): boolean => {
    const go = options.onProgress?.({
      runs,
      maxRuns,
      containers: containersDone,
      placed,
      requested,
    })
    return go !== false
  }

  /** Packs what it can of `subset` into one container. */
  function fillOne(subset: BoxType[], containersDone: number, placed: number): PackResult {
    if (optimizing && runs < maxRuns) {
      const before = runs
      const r = optimize(container, subset, {
        keepUpright: options.keepUpright,
        maxWeight,
        objective: 'keep-most-volume',
        maxRuns: maxRuns - runs,
        onProgress: (p) => {
          runs = before + p.runs
          if (performance.now() - start > budgetMs) optimizing = false
          if (!report(containersDone, placed)) optimizing = false
          return optimizing
        },
      })
      runs = before + r.runs
      return r.result
    }
    runs++
    // skipChecks: what is left may well exceed one container; that is the point.
    return asOwnPacking(
      pack(container, subset, { keepUpright: options.keepUpright, maxWeight, skipChecks: true }),
    )
  }

  /** Fills containers one after another; `shareFor` says what to offer each one. */
  function fillAll(
    shareFor: (left: Quantities, containersDone: number) => Quantities,
  ): PackResult[] {
    const remaining = { ...requestedOf }
    const filled: PackResult[] = []
    let placed = 0
    while (sum(remaining) > 0 && filled.length < maxContainers) {
      const share = shareFor(remaining, filled.length)
      const subset = packable
        .filter((t) => (share[t.id] ?? 0) > 0)
        .map((t) => ({ ...t, qty: share[t.id]! }))
      const result = fillOne(subset, filled.length, placed)
      // Every packable type fits in an empty container, so this cannot trigger;
      // it only guards against looping forever.
      if (result.placements.length === 0) break
      filled.push(result)
      for (const p of result.placements) remaining[p.typeId]!--
      placed += result.placements.length
    }
    return filled
  }

  const allocation = options.allocation ?? []

  /** The mode's share of a container, with any count the caller pinned to it. */
  function shareOf(base: Quantities, rest: Quantities, index: number): Quantities {
    const pinned = allocation[index]
    if (!pinned) return base
    const share = { ...base }
    for (const t of packable) {
      const want = pinned[t.id]
      // Never more than is left over: a pin from a bigger order still makes sense.
      if (want !== undefined) share[t.id] = Math.min(want, rest[t.id] ?? 0)
    }
    return share
  }

  const everything = (rest: Quantities, index: number) => shareOf(rest, rest, index)
  let containers = fillAll(everything)
  if (mode === 'even' && containers.length > 1) {
    // Now that the container count is known, hand each one its share. An even
    // load is not worth an extra container, so a wider spread is turned down -
    // unless the caller pinned counts, in which case that split is the point.
    const target = containers.length
    const pinned = allocation.some((c) => c !== undefined)
    const spread = fillAll((rest, done) =>
      shareOf(evenShare(packable, rest, Math.max(1, target - done)), rest, done),
    )
    if (pinned || spread.length <= containers.length) containers = spread
  }

  const placedOf: Quantities = { ...requestedOf }
  let placed = 0
  for (const c of containers) {
    for (const p of c.placements) {
      placedOf[p.typeId]!--
      placed++
    }
  }

  let status: MultiStatus = impossibility ? 'impossible' : 'fits'
  if (placed < sum(requestedOf)) {
    status = 'limit'
    for (const [id, n] of Object.entries(placedOf)) if (n > 0) unplaced[id] = n
  }
  const placedVolume = containers.reduce((v, c) => v + c.stats.placedVolume, 0)
  const weight = containers.reduce((w, c) => w + c.stats.weight, 0)
  return {
    status,
    ...(impossibility ? { impossibility } : {}),
    containers,
    unplaced,
    stats: {
      containers: containers.length,
      requested,
      placed,
      weight,
      maxWeight,
      containerVolume,
      placedVolume,
      fill: containers.length > 0 ? placedVolume / (containers.length * containerVolume) : 0,
      ms: performance.now() - start,
    },
    runs,
  }
}
