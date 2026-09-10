import type { Box, Container, Dims, Point, Size } from './types'

/** True when the box touches one of the container's four vertical walls. */
export function againstWall(p: Point, s: Size, c: Container): boolean {
  return p.x === 0 || p.y === 0 || p.x + s.dx === c.l || p.y + s.dy === c.w
}

/**
 * True when a box at `p` would sit in the space above `under`: at or over its
 * top, with their footprints overlapping. Nothing may be above a fragile box.
 */
export function above(p: Point, s: Size, under: Box): boolean {
  return (
    p.z >= under.z + under.dz &&
    p.x < under.x + under.dx &&
    under.x < p.x + s.dx &&
    p.y < under.y + under.dy &&
    under.y < p.y + s.dy
  )
}

/** Weight of one box of this type; unknown weights count as nothing. */
export function boxWeight(t: { weight?: number }): number {
  return t.weight ?? 0
}

export function volume({ l, w, h }: Dims): number {
  return l * w * h
}

export function sizeVolume({ dx, dy, dz }: Size): number {
  return dx * dy * dz
}

const size = (dx: number, dy: number, dz: number): Size => ({ dx, dy, dz })

/**
 * Axis-aligned orientations of a box, without duplicates: a cube has 1, a box
 * with two equal sides 3, otherwise 6. The natural orientation (l, w, h) comes
 * first and the rotation around the vertical axis second, so a first-fit
 * search prefers upright placements. With keepUpright only those two are
 * returned; the height always stays vertical.
 */
export function orientations({ l, w, h }: Dims, keepUpright: boolean): Size[] {
  const candidates = keepUpright
    ? [size(l, w, h), size(w, l, h)]
    : [size(l, w, h), size(w, l, h), size(l, h, w), size(h, l, w), size(w, h, l), size(h, w, l)]
  const seen = new Set<string>()
  return candidates.filter((s) => {
    const key = `${s.dx},${s.dy},${s.dz}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Strict overlap: boxes that only touch (shared face, edge or corner) do not overlap. */
export function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.dx &&
    b.x < a.x + a.dx &&
    a.y < b.y + b.dy &&
    b.y < a.y + a.dy &&
    a.z < b.z + b.dz &&
    b.z < a.z + a.dz
  )
}

/**
 * True when p lies in the half-open volume [min, min + size) of the box.
 * Any box placed with its min corner at such a point overlaps b at p itself,
 * which makes p useless as a candidate position.
 */
export function covered(p: Point, b: Box): boolean {
  return (
    b.x <= p.x &&
    p.x < b.x + b.dx &&
    b.y <= p.y &&
    p.y < b.y + b.dy &&
    b.z <= p.z &&
    p.z < b.z + b.dz
  )
}

/** True when a box of size s with its min corner at p lies entirely inside the container. */
export function insideContainer(p: Point, s: Size, container: Dims): boolean {
  return (
    p.x >= 0 &&
    p.y >= 0 &&
    p.z >= 0 &&
    p.x + s.dx <= container.l &&
    p.y + s.dy <= container.w &&
    p.z + s.dz <= container.h
  )
}
