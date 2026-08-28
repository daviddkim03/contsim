import { describe, expect, it } from 'vitest'
import {
  describeImpossibility,
  findImpossibility,
  maxOfTypeAlone,
} from '../../src/core/feasibility'
import type { BoxType, Container } from '../../src/core/types'

const type = (id: string, l: number, w: number, h: number, qty: number): BoxType => ({
  id,
  name: `Box ${id.toUpperCase()}`,
  dims: { l, w, h },
  qty,
  color: '#000000',
})
const free = { keepUpright: false }
const upright = { keepUpright: true }
const cube10: Container = { l: 10, w: 10, h: 10 }
const cube4: Container = { l: 4, w: 4, h: 4 }
const tall: Container = { l: 1, w: 1, h: 10 }

describe('findImpossibility', () => {
  it('returns null when nothing rules the scenario out', () => {
    expect(
      findImpossibility(cube10, [type('a', 1, 1, 1, 8), type('b', 5, 5, 5, 4)], free),
    ).toBeNull()
  })

  it('returns null for an empty box list', () => {
    expect(findImpossibility(cube10, [], free)).toBeNull()
  })

  it('ignores types with quantity 0', () => {
    expect(findImpossibility(cube10, [type('a', 11, 1, 1, 0)], free)).toBeNull()
  })

  describe('oversize', () => {
    it('fires when a box fits in no orientation', () => {
      expect(findImpossibility(cube10, [type('a', 11, 1, 1, 1)], free)).toEqual({
        kind: 'oversize',
        typeId: 'a',
      })
    })

    it('does not fire when a rotation makes the box fit', () => {
      expect(findImpossibility(tall, [type('a', 10, 1, 1, 1)], free)).toBeNull()
    })

    it('respects keepUpright', () => {
      expect(findImpossibility(tall, [type('a', 10, 1, 1, 1)], upright)).toEqual({
        kind: 'oversize',
        typeId: 'a',
      })
    })
  })

  describe('volume', () => {
    it('fires when the total box volume exceeds the container volume', () => {
      expect(findImpossibility(cube4, [type('a', 1, 1, 1, 70)], free)).toEqual({
        kind: 'volume',
        boxVolume: 70,
        containerVolume: 64,
      })
    })

    it('does not fire when the boxes exactly fill the container', () => {
      expect(findImpossibility(cube4, [type('a', 1, 1, 1, 64)], free)).toBeNull()
    })

    it('sums quantities across types', () => {
      expect(
        findImpossibility(cube4, [type('a', 2, 2, 2, 8), type('b', 1, 1, 1, 1)], free),
      ).toEqual({
        kind: 'volume',
        boxVolume: 65,
        containerVolume: 64,
      })
    })
  })

  describe('upper bound', () => {
    it('fires when two large boxes cannot be separated along any axis', () => {
      // 2 x 216 = 432 is well under 1000, so only the lattice bound catches this.
      expect(findImpossibility(cube10, [type('a', 6, 6, 6, 2)], free)).toEqual({
        kind: 'upper-bound',
        typeId: 'a',
        qty: 2,
        maxAlone: 1,
      })
    })

    it('does not fire for a quantity the bound allows', () => {
      expect(findImpossibility(cube10, [type('a', 6, 6, 6, 1)], free)).toBeNull()
    })

    it('uses the smallest side as the spacing when boxes may rotate', () => {
      // 6 x 6 x 1 slabs can stand on edge, so the spacing is 1 and the bound is 1000.
      expect(findImpossibility(cube10, [type('a', 6, 6, 1, 20)], free)).toBeNull()
    })

    it('uses the height as the vertical spacing with keepUpright', () => {
      // Upright 6 x 6 x 1 slabs can only be stacked: floor(10/6) * floor(10/6) * floor(10/1) = 10.
      expect(findImpossibility(cube10, [type('a', 6, 6, 1, 10)], upright)).toBeNull()
      expect(findImpossibility(cube10, [type('a', 6, 6, 1, 11)], upright)).toEqual({
        kind: 'upper-bound',
        typeId: 'a',
        qty: 11,
        maxAlone: 10,
      })
    })

    it('never rules out an arrangement that needs mixed orientations (pinwheel)', () => {
      // Four 3 x 2 x 1 boxes fit in 5 x 5 x 1 as a pinwheel, although no
      // single-orientation grid holds more than 2. A grid count would be unsound here.
      const pinwheel = [type('a', 3, 2, 1, 4), type('b', 1, 1, 1, 1)]
      expect(findImpossibility({ l: 5, w: 5, h: 1 }, pinwheel, free)).toBeNull()
    })
  })

  it('reports oversize before volume when both apply', () => {
    expect(findImpossibility(cube4, [type('a', 5, 1, 1, 100)], free)).toEqual({
      kind: 'oversize',
      typeId: 'a',
    })
  })
})

describe('maxOfTypeAlone', () => {
  it('is the lattice bound from the smallest side', () => {
    expect(maxOfTypeAlone(cube10, { l: 6, w: 6, h: 6 }, false)).toBe(1)
    expect(maxOfTypeAlone(cube10, { l: 3, w: 4, h: 5 }, false)).toBe(27)
  })

  it('uses the height vertically with keepUpright', () => {
    expect(maxOfTypeAlone(cube10, { l: 3, w: 4, h: 5 }, true)).toBe(3 * 3 * 2)
  })

  it('is 0 when the box is larger than the container on every axis', () => {
    expect(maxOfTypeAlone(cube10, { l: 11, w: 11, h: 11 }, false)).toBe(0)
  })
})

describe('describeImpossibility', () => {
  const types = [type('a', 11, 1, 1, 1)]

  it('names the box and its dims for oversize', () => {
    expect(describeImpossibility({ kind: 'oversize', typeId: 'a' }, types)).toBe(
      'Box A (11 x 1 x 1) does not fit in the container in any allowed orientation.',
    )
  })

  it('reports both volumes', () => {
    expect(
      describeImpossibility({ kind: 'volume', boxVolume: 70, containerVolume: 64 }, types),
    ).toBe('Total box volume 70 exceeds the container volume 64.')
  })

  it('reports the bound and the requested quantity', () => {
    expect(
      describeImpossibility({ kind: 'upper-bound', typeId: 'a', qty: 2, maxAlone: 1 }, types),
    ).toBe('At most 1 of Box A can fit in an empty container; 2 requested.')
  })

  it('formats lengths and volumes with the given formatters', () => {
    const fmt = {
      length: (n: number) => `${n / 10} in`,
      volume: (n: number) => `${n / 1000} cu in`,
    }
    expect(describeImpossibility({ kind: 'oversize', typeId: 'a' }, types, fmt)).toContain(
      '(1.1 in x 0.1 in x 0.1 in)',
    )
    expect(
      describeImpossibility({ kind: 'volume', boxVolume: 70, containerVolume: 64 }, types, fmt),
    ).toBe('Total box volume 0.07 cu in exceeds the container volume 0.064 cu in.')
  })

  it('falls back to the id for an unknown type', () => {
    expect(describeImpossibility({ kind: 'oversize', typeId: 'zzz' }, types)).toBe(
      'zzz does not fit in the container in any allowed orientation.',
    )
  })
})
