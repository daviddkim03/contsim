import type { Container, Placement } from '../core'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Core space: x = length, y = width (back to front), z = height.
 * three.js is y-up, so height goes to scene y and width to scene z, which
 * keeps the origin at the back-bottom-left corner and the width axis pointing
 * toward the viewer.
 */
export function boxCenter(p: Placement): Vec3 {
  return { x: p.x + p.dx / 2, y: p.z + p.dz / 2, z: p.y + p.dy / 2 }
}

export function boxSize(p: Placement): Vec3 {
  return { x: p.dx, y: p.dz, z: p.dy }
}

/** Edges of a box: 12 segments, so 24 vertices and 72 floats. */
export const EDGE_VERTICES_PER_BOX = 24
export const EDGE_FLOATS_PER_BOX = EDGE_VERTICES_PER_BOX * 3

/** Corner pairs of a cuboid: bottom face, top face, then the four uprights. */
const EDGE_CORNERS = [
  0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
] as const

/**
 * Writes the wireframe of one placement into `out` at slot `index`, in scene
 * space. One buffer holds the edges of many boxes, which draws them all at
 * once instead of one object per box.
 */
export function writeBoxEdges(out: Float32Array, index: number, p: Placement): void {
  const c = boxCenter(p)
  const s = boxSize(p)
  const x0 = c.x - s.x / 2
  const x1 = c.x + s.x / 2
  const y0 = c.y - s.y / 2
  const y1 = c.y + s.y / 2
  const z0 = c.z - s.z / 2
  const z1 = c.z + s.z / 2
  // Bottom face counter-clockwise, then the top face above it.
  const xs = [x0, x1, x1, x0, x0, x1, x1, x0]
  const ys = [y0, y0, y0, y0, y1, y1, y1, y1]
  const zs = [z0, z0, z1, z1, z0, z0, z1, z1]
  let at = index * EDGE_FLOATS_PER_BOX
  for (const corner of EDGE_CORNERS) {
    out[at++] = xs[corner]!
    out[at++] = ys[corner]!
    out[at++] = zs[corner]!
  }
}

/** A box is shown when its bottom is at or below the layer height. null shows everything. */
export function isBelowLayer(p: { z: number }, layer: number | null): boolean {
  return layer === null || p.z <= layer
}

/**
 * How many of `placements` the layer shows, given they are sorted by z. The
 * shown boxes are then always a prefix, so moving the slider is a matter of
 * drawing fewer of them rather than rebuilding anything.
 */
export function visibleCount(placements: readonly { z: number }[], layer: number | null): number {
  if (layer === null || placements.length === 0) return placements.length
  let low = 0
  let high = placements.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (placements[mid]!.z <= layer) low = mid + 1
    else high = mid
  }
  return low
}

/** Vertical field of view of the viewer camera, in degrees. */
export const FOV = 45

/** Viewing direction: from the front-right, a little above. */
const DIRECTION = normalize({ x: 0.75, y: 0.55, z: 0.95 })

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

/**
 * Camera position and orbit target that frame the whole container, whatever
 * the viewport's aspect ratio: the bounding sphere must fit the narrower of
 * the vertical and horizontal fields of view, with a small margin.
 */
export function frameContainer(
  c: Container,
  aspect = 1,
): { position: Vec3; target: Vec3; extent: number } {
  const target = { x: c.l / 2, y: c.h / 2, z: c.w / 2 }
  const extent = Math.sqrt(c.l ** 2 + c.w ** 2 + c.h ** 2)
  const fovY = (FOV * Math.PI) / 180
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * Math.max(aspect, 0.01))
  const fit = Math.min(fovX, fovY)
  const distance = (extent / 2 / Math.sin(fit / 2)) * 1.08
  return {
    position: {
      x: target.x + DIRECTION.x * distance,
      y: target.y + DIRECTION.y * distance,
      z: target.z + DIRECTION.z * distance,
    },
    target,
    extent,
  }
}
