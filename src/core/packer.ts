import { findImpossibility } from './feasibility'
import { covered, insideContainer, orientations, overlaps, sizeVolume, volume } from './geometry'
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

export const DEFAULT_PACK_OPTIONS: PackOptions = { keepUpright: false, order: 'volume-desc' }

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
    keepUpright: options.keepUpright ?? DEFAULT_PACK_OPTIONS.keepUpright,
    order: options.order ?? DEFAULT_PACK_OPTIONS.order,
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
        ms: performance.now() - start,
      },
    }
  }

  const items = orderItems(expandTypes(types), opts.order)
  const placements: Placement[] = []
  const unplaced: Record<string, number> = {}
  let eps: Point[] = [{ x: 0, y: 0, z: 0 }]
  const sizesByDims = new Map<string, Size[]>()
  // Dims that found no position since the last placement. Nothing changed for
  // them, so identical boxes can be skipped without scanning again.
  const stuck = new Set<string>()

  for (const item of items) {
    const key = `${item.dims.l},${item.dims.w},${item.dims.h}`
    if (stuck.has(key)) {
      unplaced[item.typeId] = (unplaced[item.typeId] ?? 0) + 1
      continue
    }
    let sizes = sizesByDims.get(key)
    if (!sizes) {
      sizes = orientations(item.dims, opts.keepUpright)
      sizesByDims.set(key, sizes)
    }

    const hit = findPosition(eps, sizes, container, placements)
    if (!hit) {
      stuck.add(key)
      unplaced[item.typeId] = (unplaced[item.typeId] ?? 0) + 1
      continue
    }

    const box: Placement = { typeId: item.typeId, ...hit.point, ...hit.size }
    placements.push(box)
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
      ms: performance.now() - start,
    },
  }
}

function findPosition(
  eps: Point[],
  sizes: Size[],
  container: Container,
  placed: Box[],
): { point: Point; size: Size } | null {
  for (const point of eps) {
    for (const size of sizes) {
      if (insideContainer(point, size, container) && !overlapsAny(point, size, placed)) {
        return { point, size }
      }
    }
  }
  return null
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
