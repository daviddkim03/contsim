/**
 * Packing into as many containers of one size as it takes.
 *
 * Containers are filled one after another: each gets the boxes the packer
 * can place from what is left, and the remainder moves on to a fresh
 * container. With an optimizer budget, each container instead gets the
 * largest-volume subset the optimizer can fit (PROJECT.md section 4.3), which
 * usually saves a container on realistic loads. Both paths are deterministic.
 *
 * A box type that fits in no container in any allowed orientation can never
 * ship in this container size; the result says so (status 'impossible') and
 * still packs everything else.
 */

import { insideContainer, orientations, volume } from './geometry'
import { optimize } from './optimizer'
import { pack } from './packer'
import type { BoxType, Container, Impossibility, PackResult } from './types'
import { validateScenario } from './validate'

export type MultiStatus = 'fits' | 'impossible' | 'limit'

export interface MultiPackStats {
  containers: number
  requested: number
  placed: number
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
  /** Never open more than this many containers. Default 50. */
  maxContainers?: number
  /**
   * Packer-run budget for the optimizer across all containers. 0 (default)
   * packs every container once, first fit; that takes a few milliseconds.
   */
  optimizeRuns?: number
  /** Called after every optimizer run. Return false to finish without further optimizing. */
  onProgress?: (progress: MultiPackProgress) => boolean | void
}

export const DEFAULT_MAX_CONTAINERS = 50
export const DEFAULT_OPTIMIZE_RUNS = 400

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
  const maxContainers = options.maxContainers ?? DEFAULT_MAX_CONTAINERS
  const maxRuns = options.optimizeRuns ?? 0
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
    if (fitsAlone) packable.push(t)
    else {
      unplaced[t.id] = t.qty
      impossibility ??= { kind: 'oversize', typeId: t.id }
    }
  }

  const remaining: Quantities = Object.fromEntries(packable.map((t) => [t.id, t.qty]))
  const containers: PackResult[] = []
  let runs = 0
  let placed = 0
  let optimizing = maxRuns > 0

  const report = (): boolean => {
    const go = options.onProgress?.({
      runs,
      maxRuns,
      containers: containers.length,
      placed,
      requested,
    })
    return go !== false
  }

  while (sum(remaining) > 0 && containers.length < maxContainers) {
    const subset = packable
      .filter((t) => remaining[t.id]! > 0)
      .map((t) => ({ ...t, qty: remaining[t.id]! }))
    let result: PackResult
    if (optimizing && runs < maxRuns) {
      const before = runs
      const r = optimize(container, subset, {
        keepUpright: options.keepUpright,
        objective: 'keep-most-volume',
        maxRuns: maxRuns - runs,
        onProgress: (p) => {
          runs = before + p.runs
          if (!report()) optimizing = false
          return optimizing
        },
      })
      runs = before + r.runs
      result = r.result
    } else {
      // skipChecks: what is left may well exceed one container; that is the point.
      result = asOwnPacking(
        pack(container, subset, { keepUpright: options.keepUpright, skipChecks: true }),
      )
      runs++
    }
    // Every packable type fits in an empty container, so this cannot trigger; never loop forever.
    if (result.placements.length === 0) break
    containers.push(result)
    for (const p of result.placements) remaining[p.typeId]!--
    placed += result.placements.length
  }

  let status: MultiStatus = impossibility ? 'impossible' : 'fits'
  if (sum(remaining) > 0) {
    status = 'limit'
    for (const [id, n] of Object.entries(remaining)) if (n > 0) unplaced[id] = n
  }
  const placedVolume = containers.reduce((v, c) => v + c.stats.placedVolume, 0)
  return {
    status,
    ...(impossibility ? { impossibility } : {}),
    containers,
    unplaced,
    stats: {
      containers: containers.length,
      requested,
      placed,
      containerVolume,
      placedVolume,
      fill: containers.length > 0 ? placedVolume / (containers.length * containerVolume) : 0,
      ms: performance.now() - start,
    },
    runs,
  }
}
