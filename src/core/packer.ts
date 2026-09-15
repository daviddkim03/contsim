import { findImpossibility } from './feasibility'
import {
  againstWall,
  boxWeight,
  covered,
  footprintsOverlap,
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
 * Fragile boxes (section 4.5) come first and are reserved a place against a
 * wall with their top at the roof, so the load is packed beneath them and
 * nothing can be above them. Once the load is in, each one comes down to
 * rest on whatever ended up under it.
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
  /** Fragile boxes, reserved at the roof and lowered onto the load at the end. */
  const reserved: Reservation[] = []
  const unplaced: Record<string, number> = {}
  let eps: Point[] = [{ x: 0, y: 0, z: 0 }]
  const sizesByDims = new Map<string, Size[]>()
  // Dims that found no position since the last placement. Nothing changed for
  // them, so identical boxes can be skipped without scanning again.
  const stuck = new Set<string>()
  // Per candidate point, the fragile sizes that found no wall place from it.
  // Boxes are only ever added, so those stay useless; see findWallTop. Keyed
  // by identity: points survive the rebuilds of `eps`, and one Size list
  // serves every box of a kind.
  const noWallPlace = new Map<Point, Set<Size[]>>()

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

    const hit = item.fragile
      ? findWallTop(eps, sizes, container, placements, noWallPlace)
      : findPosition(eps, sizes, container, placements, reserved)
    if (!hit) {
      stuck.add(key)
      unplaced[item.typeId] = (unplaced[item.typeId] ?? 0) + 1
      continue
    }

    const box: Placement = { typeId: item.typeId, ...hit.point, ...hit.size }
    placements.push(box)
    weight += itemWeight
    stuck.clear()
    // A reserved box only offers the floor beside it: nothing goes on top of
    // it, and its own corners are up at the roof.
    let candidates: Point[]
    if (item.fragile) {
      reserved.push({ box, top: 0, support: box.dx * box.dy })
      candidates = groundPoints(box, placements)
    } else {
      for (const r of reserved) raiseSurface(r, box)
      candidates = cornerPoints(box, placements)
    }
    eps = nextExtremePoints(eps, hit.point, box, candidates, placements, container)
  }

  // The load is in: each fragile box comes down onto what is under it.
  for (const r of reserved) r.box.z = r.top

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

/**
 * A fragile box reserved at the roof, with the surface the load has built
 * under it so far: the top of the highest box under its footprint (the floor
 * to begin with) and how much of the footprint rests on boxes at that height.
 */
interface Reservation {
  box: Placement
  top: number
  support: number
}

/** Half a footprint: what a box must at least rest on, so it never perches on a sliver. */
const MIN_SUPPORT = 0.5

/** The first candidate point, in order, where some orientation fits. */
function findPosition(
  eps: Point[],
  sizes: Size[],
  container: Container,
  placed: Box[],
  reserved: Reservation[],
): { point: Point; size: Size } | null {
  for (const point of eps) {
    for (const size of sizes) {
      if (!insideContainer(point, size, container)) continue
      const box = asBox(point, size)
      // The reservations before the rest: they are the oldest boxes, which
      // the scan over everything placed reaches last, yet under them they
      // are what a tall box runs into.
      if (overlapsReserved(box, reserved) || overlapsAny(box, placed)) continue
      if (!keepsSupport(box, reserved)) continue
      return { point, size }
    }
  }
  return null
}

const asBox = (p: Point, s: Size): Box => ({ x: p.x, y: p.y, z: p.z, dx: s.dx, dy: s.dy, dz: s.dz })

function overlapsReserved(box: Box, reserved: Reservation[]): boolean {
  for (const r of reserved) if (overlaps(box, r.box)) return true
  return false
}

/**
 * True unless the box would leave a fragile box above it perched: whatever
 * ends up highest under a reserved footprint is what the fragile box comes to
 * rest on, and that must carry at least MIN_SUPPORT of the footprint.
 */
function keepsSupport(box: Box, reserved: Reservation[]): boolean {
  const top = box.z + box.dz
  for (const r of reserved) {
    if (top < r.top || !footprintsOverlap(box, r.box)) continue
    const area = overlapArea(box, r.box)
    const support = top === r.top ? r.support + area : area
    if (support < MIN_SUPPORT * r.box.dx * r.box.dy) return false
  }
  return true
}

/** Records a placed box in the surface under a reservation it lies under. */
function raiseSurface(r: Reservation, box: Box): void {
  const top = box.z + box.dz
  if (top < r.top || !footprintsOverlap(box, r.box)) return
  const area = overlapArea(box, r.box)
  if (top > r.top) {
    r.top = top
    r.support = area
  } else {
    r.support += area
  }
}

function overlapArea(a: Box, b: Box): number {
  const dx = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x)
  const dy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y)
  return dx * dy
}

/**
 * Where a fragile box is reserved: against one of the four walls, with its
 * top at the roof so that nothing can be above it and the load packs beneath.
 * Once the load is in it comes down onto the surface under it (Reservation).
 * A candidate point only lends its floor-plan position, and since candidate
 * points are the corners of placed boxes, the box is also tried slid across
 * to the far walls - otherwise it could only reach the walls a placement
 * happens to end on, which throws away most of the container.
 *
 * Wall space is what limits fragile boxes, so at a point the box goes in
 * the orientation that takes the least of it: a thin panel stands across
 * the wall, not along it.
 *
 * A point that offers a size no place will never offer one: the walls do
 * not move and what is placed only grows. `dead` remembers those points per
 * size, which is what keeps a ring of hundreds of boxes cheap to build.
 */
function findWallTop(
  eps: Point[],
  sizes: Size[],
  container: Container,
  placed: Box[],
  dead: Map<Point, Set<Size[]>>,
): { point: Point; size: Size } | null {
  for (const point of eps) {
    const deadHere = dead.get(point)
    if (deadHere?.has(sizes)) continue
    let best: { point: Point; size: Size; alongWall: number } | null = null
    for (const size of sizes) {
      const roof = { x: point.x, y: point.y, z: container.h - size.dz }
      for (const candidate of slidToWalls(roof, size, container)) {
        if (!insideContainer(candidate, size, container)) continue
        if (!againstWall(candidate, size, container)) continue
        if (overlapsAny(asBox(candidate, size), placed)) continue
        const alongWall = wallExtent(candidate, size, container)
        if (!best || alongWall < best.alongWall) best = { point: candidate, size, alongWall }
      }
    }
    if (best) return { point: best.point, size: best.size }
    if (deadHere) deadHere.add(sizes)
    else dead.set(point, new Set([sizes]))
  }
  return null
}

/** How much of the wall it touches a box takes up; the shorter side in a corner. */
function wallExtent(p: Point, s: Size, c: Container): number {
  const onEndWall = p.x === 0 || p.x + s.dx === c.l
  const onSideWall = p.y === 0 || p.y + s.dy === c.w
  if (onEndWall && onSideWall) return Math.min(s.dx, s.dy)
  return onEndWall ? s.dy : s.dx
}

/** A point and the same point slid across to the far walls. */
function slidToWalls(p: Point, s: Size, c: Container): Point[] {
  return [
    p,
    { ...p, x: c.l - s.dx },
    { ...p, y: c.w - s.dy },
    { x: c.l - s.dx, y: c.w - s.dy, z: p.z },
  ]
}

function overlapsAny(candidate: Box, placed: Box[]): boolean {
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

/** The box's three corner points and the gravity-dropped copies of the two at its own height. */
function cornerPoints(box: Box, placed: Box[]): Point[] {
  const right = { x: box.x + box.dx, y: box.y, z: box.z }
  const front = { x: box.x, y: box.y + box.dy, z: box.z }
  const top = { x: box.x, y: box.y, z: box.z + box.dz }
  return [
    right,
    front,
    top,
    { ...right, z: dropZ(right, placed) },
    { ...front, z: dropZ(front, placed) },
  ]
}

/** Only the gravity-dropped points beside the box. */
function groundPoints(box: Box, placed: Box[]): Point[] {
  const right = { x: box.x + box.dx, y: box.y, z: box.z }
  const front = { x: box.x, y: box.y + box.dy, z: box.z }
  return [
    { ...right, z: dropZ(right, placed) },
    { ...front, z: dropZ(front, placed) },
  ]
}

/**
 * Candidate points after placing `box` at `used`: drop the used point and any
 * point now covered by the box, add the given candidates, keep everything
 * inside the container, deduplicated and sorted lowest-first.
 */
function nextExtremePoints(
  eps: Point[],
  used: Point,
  box: Box,
  candidates: Point[],
  placed: Box[],
  container: Container,
): Point[] {
  const usedKey = pointKey(used)
  const next = eps.filter((p) => pointKey(p) !== usedKey && !covered(p, box))
  const keys = new Set(next.map(pointKey))

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
