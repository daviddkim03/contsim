import { findImpossibility } from './feasibility'
import {
  above,
  againstWall,
  boxWeight,
  covered,
  insideContainer,
  orientations,
  overlaps,
  sizeVolume,
  volume,
} from './geometry'
import { expandTypes, orderItems } from './ordering'
import type {
  Box,
  BoxType,
  Container,
  PackOptions,
  PackResult,
  Placement,
  Point,
  Size,
} from './types'
import { validateScenario } from './validate'

export const DEFAULT_PACK_OPTIONS: PackOptions = { order: 'volume-desc' }

/**
 * Extreme-point first-fit packer (PROJECT.md section 4.2).
 *
 * Boxes are tried one at a time in the requested order. Each box goes to the
 * first candidate point (lowest z, then y, then x) where some allowed
 * orientation fits inside the container without overlapping a placed box.
 * A placed box contributes new candidate points at its corners, plus
 * "gravity-dropped" copies so boxes can fill holes and rest on real surfaces.
 *
 * Deterministic: the same input always yields the same placements.
 * Throws on structurally invalid input; see validateScenario.
 */
export function pack(
  container: Container,
  types: BoxType[],
  options: Partial<PackOptions> = {},
): PackResult {
  const start = performance.now()
  // Explicit undefined must not override a default, so no object spread here.
  const opts: PackOptions = {
    order: options.order ?? DEFAULT_PACK_OPTIONS.order,
    maxWeight: options.maxWeight ?? 0,
    skipChecks: options.skipChecks ?? false,
  }

  const issues = validateScenario(container, types)
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.path} ${i.message}`).join('; ')
    throw new Error(`Invalid scenario: ${detail}`)
  }

  const requested = types.reduce((n, t) => n + t.qty, 0)
  const containerVolume = volume(container)

  const impossibility = opts.skipChecks ? null : findImpossibility(container, types, opts)
  if (impossibility) {
    const unplaced: Record<string, number> = {}
    for (const t of types) if (t.qty > 0) unplaced[t.id] = t.qty
    return {
      status: 'impossible',
      impossibility,
      placements: [],
      unplaced,
      stats: {
        containerVolume,
        placedVolume: 0,
        fill: 0,
        placed: 0,
        requested,
        weight: 0,
        ms: performance.now() - start,
      },
    }
  }

  const items = orderItems(expandTypes(types), opts.order)
  const weights = new Map(types.map((t) => [t.id, boxWeight(t)]))
  const maxWeight = opts.maxWeight ?? 0
  let weight = 0
  const placements: Placement[] = []
  /** Boxes that may carry nothing above them. */
  const fragile: Box[] = []
  const unplaced: Record<string, number> = {}
  let eps: Point[] = [{ x: 0, y: 0, z: 0 }]
  const sizesByDims = new Map<string, Size[]>()
  // Dims that found no position since the last placement. Nothing changed for
  // them, so identical boxes can be skipped without scanning again.
  const stuck = new Set<string>()

  for (const item of items) {
    // Fragility changes both the orientations and where a box may go, so it
    // belongs in the key that caches sizes and remembers dead ends.
    const key = `${item.dims.l},${item.dims.w},${item.dims.h},${item.fragile}`
    if (stuck.has(key)) {
      unplaced[item.typeId] = (unplaced[item.typeId] ?? 0) + 1
      continue
    }
    // Too heavy for what is left of the payload. A lighter box may still go
    // in, so this is not a dead size; leave `stuck` alone.
    const itemWeight = weights.get(item.typeId) ?? 0
    if (maxWeight > 0 && weight + itemWeight > maxWeight) {
      unplaced[item.typeId] = (unplaced[item.typeId] ?? 0) + 1
      continue
    }
    let sizes = sizesByDims.get(key)
    if (!sizes) {
      sizes = orientations(item.dims, item.fragile)
      sizesByDims.set(key, sizes)
    }

    const hit = findPosition(eps, sizes, container, placements, fragile, item.fragile)
    if (!hit) {
      stuck.add(key)
      unplaced[item.typeId] = (unplaced[item.typeId] ?? 0) + 1
      continue
    }

    const box: Placement = { typeId: item.typeId, ...hit.point, ...hit.size }
    placements.push(box)
    if (item.fragile) fragile.push(box)
    weight += itemWeight
    stuck.clear()
    eps = nextExtremePoints(eps, hit.point, box, placements, container)
  }

  const placedVolume = placements.reduce((v, p) => v + sizeVolume(p), 0)
  return {
    status: placements.length === requested ? 'fits' : 'not-found',
    placements,
    unplaced,
    stats: {
      containerVolume,
      placedVolume,
      fill: placedVolume / containerVolume,
      placed: placements.length,
      requested,
      weight,
      ms: performance.now() - start,
    },
  }
}

function findPosition(
  eps: Point[],
  sizes: Size[],
  container: Container,
  placed: Box[],
  fragile: Box[],
  wantsWall: boolean,
): { point: Point; size: Size } | null {
  for (const point of eps) {
    for (const size of sizes) {
      for (const candidate of wantsWall ? slidToWalls(point, size, container) : [point]) {
        if (candidate.x < 0 || candidate.y < 0) continue
        if (!insideContainer(candidate, size, container)) continue
        if (wantsWall && !againstWall(candidate, size, container)) continue
        if (overlapsAny(candidate, size, placed)) continue
        // Nothing may sit above a fragile box, whatever it is.
        if (fragile.some((f) => above(candidate, size, f))) continue
        return { point: candidate, size }
      }
    }
  }
  return null
}

/**
 * A candidate point and the same point slid across to the far walls. Candidate
 * points are the corners of placed boxes, so without this a box could only
 * ever reach the walls a placement happens to end on - which for a box that
 * must touch one (see BoxType.fragile) throws away half the container.
 */
function slidToWalls(p: Point, s: Size, c: Container): Point[] {
  return [
    p,
    { ...p, x: c.l - s.dx },
    { ...p, y: c.w - s.dy },
    { x: c.l - s.dx, y: c.w - s.dy, z: p.z },
  ]
}

function overlapsAny(p: Point, s: Size, placed: Box[]): boolean {
  const candidate: Box = { x: p.x, y: p.y, z: p.z, dx: s.dx, dy: s.dy, dz: s.dz }
  // Recently placed boxes sit at the frontier, so scanning backwards exits early more often.
  for (let i = placed.length - 1; i >= 0; i--) {
    if (overlaps(candidate, placed[i]!)) return true
  }
  return false
}

/** Height of the highest box top under p (or the floor), so a point can rest on a real surface. */
function dropZ(p: Point, placed: Box[]): number {
  let z = 0
  for (const b of placed) {
    const top = b.z + b.dz
    if (top <= p.z && top > z && b.x <= p.x && p.x < b.x + b.dx && b.y <= p.y && p.y < b.y + b.dy) {
      z = top
    }
  }
  return z
}

const pointKey = (p: Point) => `${p.x},${p.y},${p.z}`
const byZYX = (a: Point, b: Point) => a.z - b.z || a.y - b.y || a.x - b.x

/**
 * Candidate points after placing `box` at `used`: drop the used point and any
 * point now covered by the box, add the box's three corner points and the
 * gravity-dropped copies of the two floor-level ones, keep everything inside
 * the container, deduplicated and sorted lowest-first.
 */
function nextExtremePoints(
  eps: Point[],
  used: Point,
  box: Box,
  placed: Box[],
  container: Container,
): Point[] {
  const usedKey = pointKey(used)
  const next = eps.filter((p) => pointKey(p) !== usedKey && !covered(p, box))
  const keys = new Set(next.map(pointKey))

  const right = { x: box.x + box.dx, y: box.y, z: box.z }
  const front = { x: box.x, y: box.y + box.dy, z: box.z }
  const top = { x: box.x, y: box.y, z: box.z + box.dz }
  const candidates = [
    right,
    front,
    top,
    { ...right, z: dropZ(right, placed) },
    { ...front, z: dropZ(front, placed) },
  ]

  for (const c of candidates) {
    if (c.x >= container.l || c.y >= container.w || c.z >= container.h) continue
    const key = pointKey(c)
    if (keys.has(key)) continue
    if (placed.some((b) => covered(c, b))) continue
    keys.add(key)
    next.push(c)
  }

  next.sort(byZYX)
  return next
}
