import { describe, expect, it } from 'vitest'
import type { Placement } from '../../src/core'
import { boxCenter, boxSize, frameContainer, isBelowLayer } from '../../src/ui/viewerMath'

const p: Placement = { typeId: 'a', x: 10, y: 20, z: 30, dx: 4, dy: 6, dz: 8 }

describe('scene mapping', () => {
  it('maps core height to scene y and core width to scene z', () => {
    expect(boxCenter(p)).toEqual({ x: 12, y: 34, z: 23 })
    expect(boxSize(p)).toEqual({ x: 4, y: 8, z: 6 })
  })
})

describe('isBelowLayer', () => {
  it('shows a box when its bottom is at or below the layer, or when there is no layer', () => {
    expect(isBelowLayer({ z: 30 }, null)).toBe(true)
    expect(isBelowLayer({ z: 30 }, 30)).toBe(true)
    expect(isBelowLayer({ z: 30 }, 29)).toBe(false)
    expect(isBelowLayer({ z: 0 }, 0)).toBe(true)
  })
})

describe('frameContainer', () => {
  it('targets the container center from in front, to the right and above', () => {
    const { position, target, extent } = frameContainer({ l: 232, w: 92, h: 94 })
    expect(target).toEqual({ x: 116, y: 47, z: 46 })
    expect(extent).toBeCloseTo(266.5, 0)
    expect(position.x).toBeGreaterThan(target.x)
    expect(position.y).toBeGreaterThan(target.y)
    expect(position.z).toBeGreaterThan(target.z)
    // Far enough to fit the bounding sphere in a 45 degree field of view.
    const distance = Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z)
    expect(distance).toBeGreaterThan(extent / 2 / Math.sin(Math.PI / 8))
  })

  it('backs off further for narrow viewports and keeps the same direction', () => {
    const c = { l: 232, w: 92, h: 94 }
    const wide = frameContainer(c, 2)
    const square = frameContainer(c, 1)
    const narrow = frameContainer(c, 0.5)
    const dist = (f: typeof wide) =>
      Math.hypot(f.position.x - f.target.x, f.position.y - f.target.y, f.position.z - f.target.z)
    expect(dist(wide)).toBeCloseTo(dist(square), 6)
    expect(dist(narrow)).toBeGreaterThan(dist(square) * 1.5)
    const dir = (f: typeof wide) => [
      (f.position.x - f.target.x) / dist(f),
      (f.position.y - f.target.y) / dist(f),
      (f.position.z - f.target.z) / dist(f),
    ]
    for (const [i, v] of dir(narrow).entries()) expect(v).toBeCloseTo(dir(wide)[i]!, 6)
  })
})
