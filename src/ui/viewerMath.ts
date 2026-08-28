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

/** A box is shown when its bottom is at or below the layer height. null shows everything. */
export function isBelowLayer(p: { z: number }, layer: number | null): boolean {
  return layer === null || p.z <= layer
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
