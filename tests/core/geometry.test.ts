import { describe, expect, it } from 'vitest'
import {
  covered,
  insideContainer,
  orientations,
  overlaps,
  sizeVolume,
  volume,
} from '../../src/core/geometry'
import type { Box, Dims, Size } from '../../src/core/types'

const dims = (l: number, w: number, h: number): Dims => ({ l, w, h })
const box = (x: number, y: number, z: number, dx: number, dy: number, dz: number): Box => ({
  x,
  y,
  z,
  dx,
  dy,
  dz,
})
const sortedSides = (s: Size) => [s.dx, s.dy, s.dz].sort((a, b) => a - b)

describe('volume', () => {
  it('multiplies the three sides', () => {
    expect(volume(dims(2, 3, 4))).toBe(24)
    expect(sizeVolume({ dx: 2, dy: 3, dz: 4 })).toBe(24)
  })
})

describe('orientations', () => {
  it('returns the natural orientation first', () => {
    expect(orientations(dims(1, 2, 3), false)[0]).toEqual({ dx: 1, dy: 2, dz: 3 })
  })

  it('returns 6 orientations when all sides differ', () => {
    expect(orientations(dims(1, 2, 3), false)).toHaveLength(6)
  })

  it('returns 3 orientations when two sides are equal', () => {
    expect(orientations(dims(2, 2, 3), false)).toHaveLength(3)
    expect(orientations(dims(2, 3, 2), false)).toHaveLength(3)
    expect(orientations(dims(3, 2, 2), false)).toHaveLength(3)
  })

  it('returns 1 orientation for a cube', () => {
    expect(orientations(dims(2, 2, 2), false)).toEqual([{ dx: 2, dy: 2, dz: 2 }])
  })

  it('only permutes the sides and never repeats an orientation', () => {
    const result = orientations(dims(1, 2, 3), false)
    const keys = new Set(result.map((s) => `${s.dx},${s.dy},${s.dz}`))
    expect(keys.size).toBe(result.length)
    for (const s of result) expect(sortedSides(s)).toEqual([1, 2, 3])
  })

  describe('with keepUpright', () => {
    it('keeps the height vertical and allows the two rotations around it', () => {
      expect(orientations(dims(1, 2, 3), true)).toEqual([
        { dx: 1, dy: 2, dz: 3 },
        { dx: 2, dy: 1, dz: 3 },
      ])
    })

    it('returns 1 orientation when length equals width', () => {
      expect(orientations(dims(2, 2, 3), true)).toEqual([{ dx: 2, dy: 2, dz: 3 }])
      expect(orientations(dims(2, 2, 2), true)).toEqual([{ dx: 2, dy: 2, dz: 2 }])
    })

    it('still returns 2 orientations when only width equals height', () => {
      expect(orientations(dims(2, 3, 3), true)).toHaveLength(2)
    })
  })
})

describe('overlaps', () => {
  const unit = box(0, 0, 0, 2, 2, 2)

  it('detects interpenetrating boxes', () => {
    expect(overlaps(unit, box(1, 1, 1, 2, 2, 2))).toBe(true)
  })

  it('is symmetric', () => {
    const other = box(1, 0, 0, 3, 1, 1)
    expect(overlaps(unit, other)).toBe(true)
    expect(overlaps(other, unit)).toBe(true)
  })

  it('treats boxes sharing a face as not overlapping', () => {
    expect(overlaps(unit, box(2, 0, 0, 2, 2, 2))).toBe(false)
    expect(overlaps(unit, box(0, 2, 0, 2, 2, 2))).toBe(false)
    expect(overlaps(unit, box(0, 0, 2, 2, 2, 2))).toBe(false)
  })

  it('treats boxes sharing only an edge or a corner as not overlapping', () => {
    expect(overlaps(unit, box(2, 2, 0, 2, 2, 2))).toBe(false)
    expect(overlaps(unit, box(2, 2, 2, 2, 2, 2))).toBe(false)
  })

  it('treats separated boxes as not overlapping', () => {
    expect(overlaps(unit, box(5, 5, 5, 1, 1, 1))).toBe(false)
  })

  it('treats a box inside another as overlapping', () => {
    expect(overlaps(box(0, 0, 0, 10, 10, 10), box(3, 3, 3, 1, 1, 1))).toBe(true)
  })

  it('treats a box as overlapping itself', () => {
    expect(overlaps(unit, unit)).toBe(true)
  })
})

describe('covered', () => {
  const b = box(0, 0, 0, 2, 2, 2)

  it('includes the min corner, the near faces and the interior', () => {
    expect(covered({ x: 0, y: 0, z: 0 }, b)).toBe(true)
    expect(covered({ x: 0, y: 1, z: 1 }, b)).toBe(true)
    expect(covered({ x: 1, y: 1, z: 1 }, b)).toBe(true)
  })

  it('excludes the far faces and the max corner', () => {
    expect(covered({ x: 2, y: 1, z: 1 }, b)).toBe(false)
    expect(covered({ x: 1, y: 2, z: 1 }, b)).toBe(false)
    expect(covered({ x: 1, y: 1, z: 2 }, b)).toBe(false)
    expect(covered({ x: 2, y: 2, z: 2 }, b)).toBe(false)
  })

  it('excludes points outside the box', () => {
    expect(covered({ x: -1, y: 0, z: 0 }, b)).toBe(false)
    expect(covered({ x: 5, y: 5, z: 5 }, b)).toBe(false)
  })
})

describe('insideContainer', () => {
  const container = dims(4, 5, 6)
  const size: Size = { dx: 2, dy: 3, dz: 4 }

  it('accepts a box flush with the walls', () => {
    expect(insideContainer({ x: 0, y: 0, z: 0 }, size, container)).toBe(true)
    expect(insideContainer({ x: 2, y: 2, z: 2 }, size, container)).toBe(true)
  })

  it('rejects a box that pokes through any wall', () => {
    expect(insideContainer({ x: 3, y: 0, z: 0 }, size, container)).toBe(false)
    expect(insideContainer({ x: 0, y: 3, z: 0 }, size, container)).toBe(false)
    expect(insideContainer({ x: 0, y: 0, z: 3 }, size, container)).toBe(false)
  })

  it('rejects negative positions', () => {
    expect(insideContainer({ x: -1, y: 0, z: 0 }, size, container)).toBe(false)
    expect(insideContainer({ x: 0, y: -1, z: 0 }, size, container)).toBe(false)
    expect(insideContainer({ x: 0, y: 0, z: -1 }, size, container)).toBe(false)
  })
})
