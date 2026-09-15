import { describe, expect, it } from 'vitest'
import type { Placement } from '../../src/core'
import {
  EDGE_FLOATS_PER_BOX,
  EDGE_VERTICES_PER_BOX,
  boxCenter,
  boxSize,
  frameContainer,
  writeBoxEdges,
} from '../../src/ui/viewerMath'
const p: Placement = { typeId: 'a', x: 10, y: 20, z: 30, dx: 4, dy: 6, dz: 8 }

describe('scene mapping', () => {
  it('maps core height to scene y and core width to scene z', () => {
    expect(boxCenter(p)).toEqual({ x: 12, y: 34, z: 23 })
    expect(boxSize(p)).toEqual({ x: 4, y: 8, z: 6 })
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

describe('writeBoxEdges', () => {
  const placement = { typeId: 't', x: 0, y: 0, z: 0, dx: 2, dy: 4, dz: 6 }

  it('writes the twelve edges of the box into its slot', () => {
    const out = new Float32Array(EDGE_FLOATS_PER_BOX * 2)
    writeBoxEdges(out, 1, placement)
    // The first slot is untouched, the second holds the box.
    expect([...out.slice(0, EDGE_FLOATS_PER_BOX)].every((v) => v === 0)).toBe(true)
    const written = [...out.slice(EDGE_FLOATS_PER_BOX)]
    expect(written).toHaveLength(EDGE_VERTICES_PER_BOX * 3)
    // Scene space: x = length, y = height, z = width, spanning the placement.
    const xs = written.filter((_, i) => i % 3 === 0)
    const ys = written.filter((_, i) => i % 3 === 1)
    const zs = written.filter((_, i) => i % 3 === 2)
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 2])
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 6])
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([0, 4])
  })

  it('draws each of the eight corners three times, one per edge meeting there', () => {
    const out = new Float32Array(EDGE_FLOATS_PER_BOX)
    writeBoxEdges(out, 0, { ...placement, x: 10, y: 20, z: 30 })
    const corners = new Map<string, number>()
    for (let i = 0; i < EDGE_VERTICES_PER_BOX; i++) {
      const key = [...out.slice(i * 3, i * 3 + 3)].join(',')
      corners.set(key, (corners.get(key) ?? 0) + 1)
    }
    expect(corners.size).toBe(8)
    expect([...corners.values()]).toEqual(Array(8).fill(3))
  })
})
