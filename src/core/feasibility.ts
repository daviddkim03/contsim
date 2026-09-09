import { boxWeight, insideContainer, orientations, volume } from './geometry'
import type { BoxType, Container, Dims, Impossibility } from './types'

export interface FeasibilityOptions {
  keepUpright: boolean
  /** What the container may carry; 0 or missing means no limit. */
  maxWeight?: number
}

const ORIGIN = { x: 0, y: 0, z: 0 }

/**
 * Cheap, definitive impossibility checks (PROJECT.md section 4.1), in order:
 * oversize box, total volume, per-type upper bound. Returns null when none
 * fire. That proves nothing; only the packer can prove that a scenario fits.
 */
export function findImpossibility(
  container: Container,
  types: BoxType[],
  opts: FeasibilityOptions,
): Impossibility | null {
  const active = types.filter((t) => t.qty > 0)

  for (const t of active) {
    const fitsSomehow = orientations(t.dims, opts.keepUpright).some((s) =>
      insideContainer(ORIGIN, s, container),
    )
    if (!fitsSomehow) return { kind: 'oversize', typeId: t.id }
    const weight = boxWeight(t)
    const maxWeight = opts.maxWeight ?? 0
    if (maxWeight > 0 && weight > maxWeight) {
      return { kind: 'overweight', typeId: t.id, weight, maxWeight }
    }
  }

  const containerVolume = volume(container)
  const boxVolume = active.reduce((sum, t) => sum + t.qty * volume(t.dims), 0)
  if (boxVolume > containerVolume) return { kind: 'volume', boxVolume, containerVolume }

  for (const t of active) {
    const maxAlone = maxOfTypeAlone(container, t.dims, opts.keepUpright)
    if (t.qty > maxAlone) return { kind: 'upper-bound', typeId: t.id, qty: t.qty, maxAlone }
  }

  return null
}

/**
 * A sound upper bound on how many boxes of one type can be inside the
 * container at once, whatever else is packed with them.
 *
 * Argument: with spacing s per axis, look at the lattice of integer points
 * (i*sx - 1, j*sy - 1, k*sz - 1) for i, j, k >= 1. Every placed box has an
 * extent of at least s along each axis, so its half-open volume contains at
 * least one lattice point, and that point has i <= floor(L/sx) (and likewise
 * for y and z) because the box lies inside the container. Two non-overlapping
 * boxes cannot share a lattice point. So the count of boxes is at most
 * floor(L/sx) * floor(W/sy) * floor(H/sz).
 *
 * With free rotation every extent is at least the smallest side. With
 * keepUpright the vertical extent is exactly h and the horizontal extents are
 * at least min(l, w).
 *
 * Note that the best single-orientation grid count is NOT a valid upper bound:
 * mixed orientations can pack more (four 3x2 boxes fit in 5x5 as a pinwheel
 * while every grid holds only two).
 */
export function maxOfTypeAlone(container: Container, dims: Dims, keepUpright: boolean): number {
  const { l, w, h } = dims
  const horizontal = keepUpright ? Math.min(l, w) : Math.min(l, w, h)
  const vertical = keepUpright ? h : Math.min(l, w, h)
  return (
    Math.floor(container.l / horizontal) *
    Math.floor(container.w / horizontal) *
    Math.floor(container.h / vertical)
  )
}

/** Number formatters so the UI can present core integers in its own units. */
export interface ImpossibilityFormat {
  length: (n: number) => string
  volume: (n: number) => string
  weight: (n: number) => string
}

const plain: ImpossibilityFormat = { length: String, volume: String, weight: String }

export function describeImpossibility(
  imp: Impossibility,
  types: BoxType[],
  fmt: ImpossibilityFormat = plain,
): string {
  const byId = (id: string) => types.find((t) => t.id === id)
  const nameOf = (id: string) => byId(id)?.name ?? id

  switch (imp.kind) {
    case 'oversize': {
      const t = byId(imp.typeId)
      const dims = t
        ? ` (${fmt.length(t.dims.l)} x ${fmt.length(t.dims.w)} x ${fmt.length(t.dims.h)})`
        : ''
      return `${nameOf(imp.typeId)}${dims} does not fit in the container in any allowed orientation.`
    }
    case 'overweight':
      return `${nameOf(imp.typeId)} weighs ${fmt.weight(imp.weight)}, more than the container may carry (${fmt.weight(imp.maxWeight)}).`
    case 'volume':
      return `Total box volume ${fmt.volume(imp.boxVolume)} exceeds the container volume ${fmt.volume(imp.containerVolume)}.`
    case 'upper-bound':
      return `At most ${imp.maxAlone} of ${nameOf(imp.typeId)} can fit in an empty container; ${imp.qty} requested.`
  }
}
