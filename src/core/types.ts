/**
 * Core data model.
 *
 * Everything in src/core works in integer units. The UI scales real-world
 * dimensions to integers at the boundary (PROJECT.md section 2), so all
 * position and extent comparisons in the core are exact.
 */

/** Intrinsic dims of a box type or container: length (x), width (y), height (z). */
export interface Dims {
  l: number
  w: number
  h: number
}

export type Container = Dims

/** Extents of an oriented box along the x, y and z axes. */
export interface Size {
  dx: number
  dy: number
  dz: number
}

export interface Point {
  x: number
  y: number
  z: number
}

/** An oriented box positioned in container space by its min corner. */
export type Box = Point & Size

export interface BoxType {
  id: string
  name: string
  dims: Dims
  qty: number
  color: string
  /**
   * Weight of one box, in whatever whole unit the caller uses for
   * PackOptions.maxWeight (the app uses grams). 0 or missing means unknown,
   * which is the same as weightless as far as the packer is concerned.
   */
  weight?: number
}

export interface Placement extends Point, Size {
  typeId: string
}

/** A complete input to the packer. */
export interface Scenario {
  container: Container
  types: BoxType[]
  keepUpright: boolean
}

/**
 * - fits: every requested box was placed (a constructive proof).
 * - impossible: proven by a quick check; see Impossibility for the reason.
 * - not-found: the heuristic could not place everything. It may still be possible.
 */
export type Status = 'fits' | 'not-found' | 'impossible'

/** Structured reason for an impossible scenario. The UI formats it with its own units. */
export type Impossibility =
  | { kind: 'oversize'; typeId: string }
  | { kind: 'overweight'; typeId: string; weight: number; maxWeight: number }
  | { kind: 'volume'; boxVolume: number; containerVolume: number }
  | { kind: 'upper-bound'; typeId: string; qty: number; maxAlone: number }

export interface PackStats {
  containerVolume: number
  placedVolume: number
  /** placedVolume / containerVolume, in [0, 1]. */
  fill: number
  placed: number
  requested: number
  /** Weight of the placed boxes; 0 when no box has one. */
  weight: number
  ms: number
}

export interface PackResult {
  status: Status
  impossibility?: Impossibility
  placements: Placement[]
  /** typeId -> number of boxes of that type that could not be placed. */
  unplaced: Record<string, number>
  stats: PackStats
}

export type Ordering =
  | 'volume-desc'
  | 'volume-asc'
  | 'height-desc'
  | 'footprint-desc'
  | 'round-robin'
  | { shuffle: number }

export interface PackOptions {
  /** Only allow rotations around the vertical axis (height stays vertical). */
  keepUpright: boolean
  order: Ordering
  /**
   * What the container may carry, in the same unit as BoxType.weight. A box
   * that would take the load past it is left for another container. 0 (the
   * default) means no limit.
   */
  maxWeight?: number
  /**
   * Skip the quick impossibility checks and always attempt placement. The
   * optimizer uses this to get a feasible partial packing even when the full
   * request is provably impossible.
   */
  skipChecks?: boolean
}

export type Objective = 'keep-most-boxes' | 'keep-most-volume' | 'cut-evenly'

export interface OptimizeResult {
  /** typeId -> quantity that fits. */
  kept: Record<string, number>
  /** typeId -> requested minus kept. */
  removed: Record<string, number>
  /** The packing of the kept set; always status 'fits'. */
  result: PackResult
  runs: number
  ms: number
}
