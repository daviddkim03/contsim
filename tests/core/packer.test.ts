import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../src/core/ordering'
import { pack } from '../../src/core/packer'
import type { Ordering, Scenario } from '../../src/core/types'
import { mixedScenario } from '../../src/scenarios'
import {
  boxType,
  cube27,
  overfull,
  oversize,
  packingViolation,
  perf300,
  pinwheel,
  rotation,
  tiny,
} from './fixtures'

const run = (s: Scenario, order?: Ordering) => pack(s.container, s.types, { order })

describe('pack', () => {
  it('packs 8 unit cubes into a 2x2x2 container', () => {
    const r = run(tiny)
    expect(r.status).toBe('fits')
    expect(r.placements).toHaveLength(8)
    expect(r.stats).toMatchObject({ fill: 1, placed: 8, requested: 8 })
    expect(r.unplaced).toEqual({})
    expect(packingViolation(tiny, r)).toBeNull()
  })

  it('packs 27 unit cubes into a 3x3x3 container', () => {
    const r = run(cube27)
    expect(r.status).toBe('fits')
    expect(r.stats.fill).toBe(1)
    expect(packingViolation(cube27, r)).toBeNull()
  })

  it('fills layers from the bottom up', () => {
    const r = run(tiny)
    expect(r.placements.slice(0, 4).every((p) => p.z === 0)).toBe(true)
    expect(r.placements.slice(4).every((p) => p.z === 1)).toBe(true)
  })

  it('rotates a box to make it fit', () => {
    const r = run(rotation)
    expect(r.status).toBe('fits')
    expect(r.placements[0]).toMatchObject({ x: 0, y: 0, z: 0, dx: 1, dy: 1, dz: 10 })
  })

  it('reports impossible when a fragile box may not be laid down to fit', () => {
    const upright = {
      ...rotation,
      types: [{ ...rotation.types[0]!, fragile: true }],
    }
    const r = run(upright)
    expect(r.status).toBe('impossible')
    expect(r.impossibility).toEqual({ kind: 'oversize', typeId: 'rod' })
    expect(packingViolation(upright, r)).toBeNull()
  })

  it('reports impossible with the reason when a quick check fires', () => {
    const r = run(overfull)
    expect(r.status).toBe('impossible')
    expect(r.impossibility).toEqual({ kind: 'volume', boxVolume: 70, containerVolume: 64 })
    expect(r.placements).toEqual([])
    expect(r.unplaced).toEqual({ unit: 70 })
    expect(packingViolation(overfull, r)).toBeNull()
    expect(run(oversize).impossibility).toEqual({ kind: 'oversize', typeId: 'rod' })
  })

  it('packs the mixed 20 ft scenario completely', () => {
    const s = mixedScenario()
    const r = run(s)
    expect(r.status).toBe('fits')
    expect(packingViolation(s, r)).toBeNull()
  })

  it('says not-found, never impossible, when it merely fails to find an arrangement', () => {
    const r = run(pinwheel)
    expect(r.status).toBe('not-found')
    expect(r.impossibility).toBeUndefined()
    expect(r.stats.placed).toBeLessThan(5)
    expect(packingViolation(pinwheel, r)).toBeNull()
  })

  it('handles an empty box list and zero quantities', () => {
    const empty: Scenario = { container: { l: 5, w: 5, h: 5 }, types: [] }
    expect(run(empty)).toMatchObject({ status: 'fits', placements: [], stats: { fill: 0 } })
    const zero: Scenario = { ...empty, types: [boxType('a', 1, 1, 1, 0)] }
    expect(run(zero)).toMatchObject({ status: 'fits', placements: [], unplaced: {} })
  })

  it('throws on structurally invalid input', () => {
    expect(() => pack({ l: 0, w: 1, h: 1 }, [])).toThrow(/Invalid scenario: container\.l/)
  })

  it('is deterministic', () => {
    const s = mixedScenario()
    const a = run(s)
    const b = run(s)
    expect(b.placements).toEqual(a.placements)
    expect(b.unplaced).toEqual(a.unplaced)
  })

  describe('invariants on random scenarios', () => {
    const orderings: Ordering[] = [
      'volume-desc',
      'volume-asc',
      'height-desc',
      'footprint-desc',
      'round-robin',
      { shuffle: 3 },
    ]

    function randomScenario(seed: number): Scenario {
      const rand = mulberry32(seed)
      const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
      const container = { l: int(4, 30), w: int(4, 30), h: int(4, 30) }
      const types = Array.from({ length: int(1, 6) }, (_, i) =>
        boxType(
          `t${i}`,
          int(1, Math.ceil(container.l / 2)),
          int(1, Math.ceil(container.w / 2)),
          int(1, Math.ceil(container.h / 2)),
          int(1, 15),
        ),
      )
      return { container, types }
    }

    it('never overlaps, never leaves the container, accounts for every box', () => {
      let packedSomething = 0
      for (let seed = 1; seed <= 200; seed++) {
        const s = randomScenario(seed)
        const r = run(s, orderings[seed % orderings.length])
        expect(packingViolation(s, r), `seed ${seed}`).toBeNull()
        if (r.status === 'fits' && r.placements.length > 0) packedSomething++
      }
      // Sanity check that the generator produces plenty of real packings, not only impossible ones.
      expect(packedSomething).toBeGreaterThan(50)
    })
  })

  it('packs 300 boxes well within the time budget', () => {
    const r = run(perf300)
    expect(r.status).toBe('fits')
    expect(packingViolation(perf300, r)).toBeNull()
    expect(r.stats.ms).toBeLessThan(200)
  })

  it('leaves boxes behind once the container has taken its payload', () => {
    const types = [{ ...boxType('unit', 1, 1, 1, 8), weight: 300 }]
    const r = pack({ l: 2, w: 2, h: 2 }, types, { maxWeight: 1000 })
    // Three boxes weigh 900; a fourth would pass the limit.
    expect(r.status).toBe('not-found')
    expect(r.placements).toHaveLength(3)
    expect(r.stats.weight).toBe(900)
    expect(r.unplaced).toEqual({ unit: 5 })
    expect(packingViolation({ container: { l: 2, w: 2, h: 2 }, types }, r)).toBeNull()
  })

  it('still takes a lighter box after passing over a heavy one', () => {
    const types = [
      { ...boxType('heavy', 2, 2, 2, 1), weight: 150 },
      { ...boxType('light', 1, 1, 1, 2), weight: 50 },
    ]
    // skipChecks, because a lone box over the limit is what another container is for.
    const r = pack({ l: 2, w: 2, h: 2 }, types, { maxWeight: 100, skipChecks: true })
    expect(r.placements.map((x) => x.typeId)).toEqual(['light', 'light'])
    expect(r.stats.weight).toBe(100)
    expect(r.unplaced).toEqual({ heavy: 1 })
  })

  it('counts no weight when the boxes have none', () => {
    const r = pack({ l: 2, w: 2, h: 2 }, tiny.types, { maxWeight: 1000 })
    expect(r.stats).toMatchObject({ placed: 8, weight: 0 })
  })

  it('keeps a fragile box upright, against a wall, with nothing above it', () => {
    const container = { l: 10, w: 10, h: 10 }
    const types = [boxType('plain', 4, 4, 4, 6), boxType('china', 2, 2, 3, 4, { fragile: true })]
    const r = run({ container, types })
    const china = r.placements.filter((p) => p.typeId === 'china')
    expect(china.length).toBeGreaterThan(0)
    for (const p of china) {
      expect(p.dz).toBe(3)
      expect(p.x === 0 || p.y === 0 || p.x + p.dx === 10 || p.y + p.dy === 10).toBe(true)
    }
    expect(packingViolation({ container, types }, r)).toBeNull()
  })

  it('places the fragile boxes last, so they end up on top of the load', () => {
    const container = { l: 10, w: 10, h: 10 }
    const types = [boxType('china', 2, 2, 2, 2, { fragile: true }), boxType('plain', 2, 2, 2, 8)]
    // Fragile first in the type list, but the packer leaves them until last.
    const r = run({ container, types })
    expect(r.placements.slice(-2).every((p) => p.typeId === 'china')).toBe(true)
    expect(packingViolation({ container, types }, r)).toBeNull()
  })

  it('reaches a far wall no placement happens to end on', () => {
    // Rows of 3 deep boxes end at 3, 6 and 9, so the wall at y = 11 is only
    // reachable by sliding a box across to it.
    const container = { l: 20, w: 11, h: 4 }
    const types = [boxType('china', 3, 3, 4, 14, { fragile: true })]
    const r = run({ container, types })
    expect(r.stats.placed).toBe(14)
    expect(r.placements.some((p) => p.y + p.dy === 11)).toBe(true)
    for (const wall of [
      (p: { x: number }) => p.x === 0,
      (p: { x: number; dx: number }) => p.x + p.dx === 20,
      (p: { y: number }) => p.y === 0,
      (p: { y: number; dy: number }) => p.y + p.dy === 11,
    ]) {
      expect(r.placements.some(wall)).toBe(true)
    }
    expect(packingViolation({ container, types }, r)).toBeNull()
  })

  it('never puts a box in the space above a fragile one', () => {
    const container = { l: 4, w: 4, h: 12 }
    const types = [boxType('china', 4, 4, 3, 1, { fragile: true }), boxType('plain', 4, 4, 3, 3)]
    const r = run({ container, types })
    const china = r.placements.find((p) => p.typeId === 'china')!
    // The plain boxes fill from the floor; the fragile one caps the stack.
    expect(china.z).toBe(9)
    expect(r.stats.placed).toBe(4)
    expect(packingViolation({ container, types }, r)).toBeNull()
  })
})
