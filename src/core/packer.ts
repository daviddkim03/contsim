import { findImpossibility } from './feasibility'
import {
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
 * Fragile boxes (section 4.5) come first and are each reserved a place with
 * its top at the roof, so the load is packed beneath them and nothing can be
 * above them. Once the load is in, each one comes down to rest on whatever
 * ended up under it, which must carry at least half of it: a box that would
 * leave a fragile box perched is only placed together with enough of its
 * kind beside it to carry the fragile box between them.
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
  /** Boxes of each type still to come, which a row under a fragile box may draw on. */
  const remaining = new Map(types.map((t) => [t.id, t.qty]))
  /** Boxes of each type placed ahead of their turn, in such a row. */
  const placedAhead = new Map<string, number>()
  const placements: Placement[] = []
  /** Fragile boxes, reserved at the roof and lowered onto the load at the end. */
  const reserved: Reservation[] = []
  const unplaced: Record<string, number> = {}
  let eps: Point[] = [{ x: 0, y: 0, z: 0 }]
  const sizesByDims = new Map<string, Size[]>()
  // Dims that found no position since the last placement. Nothing changed for
  // them, so identical boxes can be skipped without scanning again.
  const stuck = new Set<string>()
  // Per candidate point, the fragile sizes that found no place over it.
  // Boxes are only ever added, so those stay useless; see findRoofPlace.
  // Keyed by identity: points survive the rebuilds of `eps`, and one Size
  // list serves every box of a kind.
  const noRoofPlace = new Map<Point, Set<Size[]>>()

  for (const item of items) {
    const ahead = placedAhead.get(item.typeId) ?? 0
    if (ahead > 0) {
      placedAhead.set(item.typeId, ahead - 1)
      continue
    }
    remaining.set(item.typeId, remaining.get(item.typeId)! - 1)
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
      if (item.fragile) sizes = byFloorCount(sizes, container)
      sizesByDims.set(key, sizes)
    }

    let group: Box[] | null
    if (item.fragile) {
      const roof = findRoofPlace(eps, sizes, container, placements, noRoofPlace)
      group = roof && [roof]
    } else {
      // How many more of its kind a row may take: what is left of the type
      // and, with a payload, what is left of that.
      const spare =
        maxWeight > 0 && itemWeight > 0
          ? Math.min(remaining.get(item.typeId)!, Math.floor((maxWeight - weight) / itemWeight) - 1)
          : remaining.get(item.typeId)!
      group = findPosition(eps, sizes, container, placements, reserved, spare)
    }
    if (!group) {
      stuck.add(key)
      unplaced[item.typeId] = (unplaced[item.typeId] ?? 0) + 1
      continue
    }

    for (const box of group) {
      const placement: Placement = { typeId: item.typeId, ...box }
      placements.push(placement)
      weight += itemWeight
      // A reserved box only offers the floor beside it: nothing goes on top
      // of it, and its own corners are up at the roof.
      let candidates: Point[]
      if (item.fragile) {
        reserved.push({ box: placement, top: 0, support: box.dx * box.dy })
        candidates = groundPoints(placement, placements)
      } else {
        for (const r of reserved) raiseSurface(r, placement)
        candidates = cornerPoints(placement, placements)
      }
      eps = nextExtremePoints(eps, box, placement, candidates, placements, container)
    }
    stuck.clear()
    if (group.length > 1) {
      remaining.set(item.typeId, remaining.get(item.typeId)! - (group.length - 1))
      placedAhead.set(item.typeId, (placedAhead.get(item.typeId) ?? 0) + group.length - 1)
    }
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

/**
 * The box at the first candidate point, in order, where some orientation
 * fits, with any more of its kind it takes beside it (see `supported`), at
 * most `spare` of them.
 */
function findPosition(
  eps: Point[],
  sizes: Size[],
  container: Container,
  placed: Box[],
  reserved: Reservation[],
  spare: number,
): Box[] | null {
  for (const point of eps) {
    for (const size of sizes) {
      if (!insideContainer(point, size, container)) continue
      const box = asBox(point, size)
      // The reservations before the rest: they are the oldest boxes, which
      // the scan over everything placed reaches last, yet under them they
      // are what a tall box runs into.
      if (overlapsReserved(box, reserved) || overlapsAny(box, placed)) continue
      const group = supported(box, reserved, placed, spare)
      if (group) return group
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
 * The box alone, unless it would leave a fragile box above it perched:
 * whatever ends up highest under a reserved footprint is what the fragile
 * box comes to rest on, and that must carry at least MIN_SUPPORT of the
 * footprint. A box that carries less on its own is still placed if it lies
 * entirely under the footprint and enough copies of it fit in rows beside
 * it there to carry half between them, as short boxes under a long fragile
 * one do; the copies are returned with it. Null when neither works.
 */
function supported(box: Box, reserved: Reservation[], placed: Box[], spare: number): Box[] | null {
  const top = box.z + box.dz
  let perched: Reservation | null = null
  for (const r of reserved) {
    if (top < r.top || !footprintsOverlap(box, r.box)) continue
    const area = overlapArea(box, r.box)
    const support = top === r.top ? r.support + area : area
    if (support >= MIN_SUPPORT * r.box.dx * r.box.dy) continue
    // A box entirely under one footprint lies under no other.
    if (!within(box, r.box)) return null
    perched = r
  }
  if (!perched) return [box]

  const f = perched.box
  const target = MIN_SUPPORT * f.dx * f.dy
  const group = [box]
  let support = box.dx * box.dy
  for (let y = box.y; support < target && y + box.dy <= f.y + f.dy; y += box.dy) {
    const first = y === box.y ? box.x + box.dx : box.x
    for (let x = first; support < target && x + box.dx <= f.x + f.dx; x += box.dx) {
      if (group.length > spare) return null
      const copy = { ...box, x, y }
      // Something lower is in the way (nothing under the footprint reaches
      // `top` yet); the row goes on past it.
      if (overlapsAny(copy, placed)) continue
      group.push(copy)
      support += box.dx * box.dy
    }
  }
  return support >= target ? group : null
}

/** True when a lies inside b seen from above. */
function within(a: Box, b: Box): boolean {
  return a.x >= b.x && a.x + a.dx <= b.x + b.dx && a.y >= b.y && a.y + a.dy <= b.y + b.dy
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
 * Where a fragile box is reserved: over a candidate point, with its top at
 * the roof so that nothing can be above it and the load packs beneath. Once
 * the load is in it comes down onto the surface under it (Reservation). The
 * candidate point only lends its floor-plan position.
 *
 * A point that offers a size no place will never offer one: what is placed
 * only grows. `dead` remembers those points per size, which is what keeps a
 * floor of hundreds of boxes cheap to build.
 */
function findRoofPlace(
  eps: Point[],
  sizes: Size[],
  container: Container,
  placed: Box[],
  dead: Map<Point, Set<Size[]>>,
): Box | null {
  for (const point of eps) {
    const deadHere = dead.get(point)
    if (deadHere?.has(sizes)) continue
    for (const size of sizes) {
      const roof = { x: point.x, y: point.y, z: container.h - size.dz }
      if (!insideContainer(roof, size, container)) continue
      const box = asBox(roof, size)
      if (overlapsAny(box, placed)) continue
      return box
    }
    if (deadHere) deadHere.add(sizes)
    else dead.set(point, new Set([sizes]))
  }
  return null
}

/**
 * Fragile boxes cannot stack, so floor area is what limits them, and the
 * orientation that fits the most of them on the floor goes first: a 1900 x
 * 100 mm panel stands across the container, not along it. Stable, so equal
 * counts keep the natural orientation first.
 */
function byFloorCount(sizes: Size[], c: Container): Size[] {
  const count = (s: Size) => Math.floor(c.l / s.dx) * Math.floor(c.w / s.dy)
  return [...sizes].sort((a, b) => count(b) - count(a))
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
