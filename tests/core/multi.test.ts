import { describe, expect, it } from 'vitest'
import {
  evenShare,
  packMany,
  type MultiPackProgress,
  type MultiPackResult,
} from '../../src/core/multi'
import { mulberry32 } from '../../src/core/ordering'
import { pack } from '../../src/core/packer'
import type { Scenario } from '../../src/core/types'
import { exampleScenario, mixedScenario } from '../../src/scenarios'
import { boxType, overfull, oversize, packingViolation, rotation, tiny } from './fixtures'

const run = (s: Scenario, optimizeRuns = 0, maxContainers?: number) =>
  packMany(s.container, s.types, {
    keepUpright: s.keepUpright,
    optimizeRuns,
    maxContainers,
    // Bound by runs alone, so a slow machine cannot change the answer.
    budgetMs: Number.POSITIVE_INFINITY,
  })

/** The first invariant a multi-container result breaks, or null. */
function multiViolation(scenario: Scenario, result: MultiPackResult): string | null {
  const counts: Record<string, number> = {}
  for (const [i, c] of result.containers.entries()) {
    if (c.status !== 'fits') return `container ${i + 1} has status ${c.status}`
    const own: Scenario = {
      ...scenario,
      types: scenario.types.map((t) => ({
        ...t,
        qty: c.placements.filter((p) => p.typeId === t.id).length,
      })),
    }
    const v = packingViolation(own, c)
    if (v) return `container ${i + 1}: ${v}`
    for (const p of c.placements) counts[p.typeId] = (counts[p.typeId] ?? 0) + 1
  }
  for (const t of scenario.types) {
    const placed = counts[t.id] ?? 0
    const unplaced = result.unplaced[t.id] ?? 0
    if (placed + unplaced !== t.qty) {
      return `${t.id}: placed ${placed} + unplaced ${unplaced} != ${t.qty}`
    }
  }
  const placed = result.containers.reduce((n, c) => n + c.placements.length, 0)
  if (result.stats.placed !== placed) return 'stats.placed is off'
  if (result.stats.containers !== result.containers.length) return 'stats.containers is off'
  const requested = scenario.types.reduce((n, t) => n + t.qty, 0)
  if (result.stats.requested !== requested) return 'stats.requested is off'
  const every = placed === requested
  if (result.status === 'fits' && !every) return 'fits but not everything is placed'
  if (result.status === 'impossible' && !result.impossibility) return 'impossible without a reason'
  return null
}

describe('packMany', () => {
  it('uses one container when everything fits', () => {
    const r = run(tiny)
    expect(r.status).toBe('fits')
    expect(r.containers).toHaveLength(1)
    expect(r.stats).toMatchObject({ containers: 1, placed: 8, requested: 8, fill: 1 })
    expect(r.runs).toBe(1)
    expect(multiViolation(tiny, r)).toBeNull()
  })

  it('opens another container for what does not fit', () => {
    // 70 unit cubes, 64 per container.
    const r = run(overfull)
    expect(r.status).toBe('fits')
    expect(r.containers.map((c) => c.placements.length)).toEqual([64, 6])
    expect(r.unplaced).toEqual({})
    expect(r.stats.fill).toBeCloseTo(70 / 128, 6)
    expect(multiViolation(overfull, r)).toBeNull()
  })

  it('reports a box that fits in no container and packs the rest', () => {
    const s: Scenario = { ...oversize, types: [...oversize.types, boxType('cube', 5, 5, 5, 9)] }
    const r = run(s)
    expect(r.status).toBe('impossible')
    expect(r.impossibility).toEqual({ kind: 'oversize', typeId: 'rod' })
    expect(r.unplaced).toEqual({ rod: 1 })
    expect(r.containers).toHaveLength(2)
    expect(r.stats.placed).toBe(9)
    expect(multiViolation(s, r)).toBeNull()
  })

  it('respects keepUpright when deciding what can ship at all', () => {
    expect(run(rotation).status).toBe('fits')
    const upright = { ...rotation, keepUpright: true }
    const r = run(upright)
    expect(r.status).toBe('impossible')
    expect(r.containers).toHaveLength(0)
    expect(r.stats.fill).toBe(0)
  })

  it('stops at the container cap and reports the rest unplaced', () => {
    const s: Scenario = {
      container: { l: 10, w: 10, h: 10 },
      keepUpright: false,
      types: [boxType('big', 10, 10, 10, 3)],
    }
    const r = run(s, 0, 2)
    expect(r.status).toBe('limit')
    expect(r.containers).toHaveLength(2)
    expect(r.unplaced).toEqual({ big: 1 })
    expect(multiViolation(s, r)).toBeNull()
  })

  it('handles an empty request', () => {
    const r = run({ ...tiny, types: [] })
    expect(r).toMatchObject({ status: 'fits', containers: [], unplaced: {}, runs: 0 })
    expect(r.stats).toMatchObject({ containers: 0, placed: 0, requested: 0, fill: 0 })
  })

  it('throws on invalid input like the packer does', () => {
    expect(() => run({ ...tiny, container: { l: 0, w: 1, h: 1 } })).toThrow(/Invalid scenario/)
  })

  it('packs the example, which overflows one container, into two', () => {
    const s = exampleScenario()
    const r = run(s)
    expect(r.status).toBe('fits')
    expect(r.containers.length).toBeGreaterThanOrEqual(2)
    expect(r.stats.placed).toBe(138)
    expect(r.containers[0]!.placements.length).toBe(pack(s.container, s.types).stats.placed)
    expect(multiViolation(s, r)).toBeNull()
  })

  it('with a budget, fills the first container at least as well and never needs more containers', () => {
    const s = exampleScenario()
    const plain = run(s)
    const best = run(s, 400)
    expect(best.status).toBe('fits')
    expect(multiViolation(s, best)).toBeNull()
    expect(best.containers.length).toBeLessThanOrEqual(plain.containers.length)
    expect(best.containers[0]!.stats.placedVolume).toBeGreaterThanOrEqual(
      plain.containers[0]!.stats.placedVolume,
    )
    expect(best.runs).toBeGreaterThan(plain.runs)
    expect(best.runs).toBeLessThanOrEqual(400 + best.containers.length)
  })

  it('is deterministic with and without a budget', () => {
    const s = exampleScenario()
    for (const budget of [0, 150]) {
      const a = run(s, budget)
      const b = run(s, budget)
      expect(b.runs).toBe(a.runs)
      expect(b.containers.map((c) => c.placements)).toEqual(a.containers.map((c) => c.placements))
    }
  })

  it('stops optimizing when the time budget runs out, and still packs everything', () => {
    const s = exampleScenario()
    // Nothing fits in no time, so every container falls back to first fit.
    const rushed = packMany(s.container, s.types, {
      keepUpright: false,
      optimizeRuns: 400,
      budgetMs: 0,
    })
    expect(rushed.status).toBe('fits')
    expect(rushed.stats.placed).toBe(138)
    expect(multiViolation(s, rushed)).toBeNull()
    expect(rushed.runs).toBeLessThan(20)
  })

  it('reports progress and can be told to stop optimizing, still returning a full packing', () => {
    const s = exampleScenario()
    const seen: MultiPackProgress[] = []
    const r = packMany(s.container, s.types, {
      keepUpright: false,
      optimizeRuns: 400,
      onProgress: (p) => {
        seen.push(p)
        return p.runs < 20
      },
    })
    expect(seen.length).toBeGreaterThanOrEqual(20)
    expect(seen.every((p, i) => i === 0 || p.runs >= seen[i - 1]!.runs)).toBe(true)
    expect(seen[0]!.maxRuns).toBe(400)
    expect(r.status).toBe('fits')
    expect(r.stats.placed).toBe(138)
    expect(multiViolation(s, r)).toBeNull()
    expect(r.runs).toBeLessThan(60)
  })

  it('spreads the boxes evenly when asked, over the same containers', () => {
    const s = exampleScenario()
    const filled = run(s)
    const even = packMany(s.container, s.types, { keepUpright: false, mode: 'even' })
    const counts = (r: MultiPackResult) => r.containers.map((c) => c.placements.length)
    // Filling one container at a time leaves the last one nearly empty; evening does not.
    expect(counts(filled)).toEqual([123, 15])
    expect(counts(even)).toEqual([69, 69])
    expect(even.status).toBe('fits')
    expect(even.stats.placed).toBe(138)
    expect(multiViolation(s, even)).toBeNull()
  })

  it('gives every container the same mix of types, not just the same count', () => {
    const s = exampleScenario()
    const even = packMany(s.container, s.types, { keepUpright: false, mode: 'even' })
    for (const t of s.types) {
      const perContainer = even.containers.map(
        (c) => c.placements.filter((p) => p.typeId === t.id).length,
      )
      // Each container holds within one box of an equal share of every type.
      const share = t.qty / even.containers.length
      for (const n of perContainer) expect(Math.abs(n - share)).toBeLessThanOrEqual(1)
    }
  })

  it('leaves a single container alone, and never opens an extra one to even out', () => {
    const single = packMany(mixedScenario().container, mixedScenario().types, {
      keepUpright: false,
      mode: 'even',
    })
    expect(single.containers).toHaveLength(1)
    expect(single.runs).toBe(1)

    const random = mulberry32(11)
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
    for (let i = 0; i < 40; i++) {
      const container = { l: int(5, 30), w: int(5, 30), h: int(5, 30) }
      const types = Array.from({ length: int(1, 4) }, (_, k) =>
        boxType(`t${k}`, int(1, 20), int(1, 20), int(1, 20), int(1, 12)),
      )
      const scenario: Scenario = { container, types, keepUpright: random() < 0.3 }
      const filled = run(scenario)
      const even = packMany(container, types, { keepUpright: scenario.keepUpright, mode: 'even' })
      expect(multiViolation(scenario, even)).toBeNull()
      expect(even.containers.length).toBeLessThanOrEqual(filled.containers.length)
      expect(even.stats.placed).toBe(filled.stats.placed)
    }
  })

  it('evens out without the optimizer, and is deterministic', () => {
    const s = exampleScenario()
    const a = packMany(s.container, s.types, {
      keepUpright: false,
      mode: 'even',
      optimizeRuns: 400,
    })
    const b = packMany(s.container, s.types, {
      keepUpright: false,
      mode: 'even',
      optimizeRuns: 400,
    })
    // Two passes over two containers; the optimizer never runs.
    expect(a.runs).toBe(4)
    expect(b.containers.map((c) => c.placements)).toEqual(a.containers.map((c) => c.placements))
  })

  it('puts a pinned number of boxes in a container and moves the rest along', () => {
    const s = exampleScenario()
    const even = packMany(s.container, s.types, { keepUpright: false, mode: 'even' })
    const perType = (r: MultiPackResult, i: number, id: string) =>
      r.containers[i]!.placements.filter((p) => p.typeId === id).length
    expect(perType(even, 0, 'small')).toBe(30)

    // Half as many small cartons in the first container; the rest go to the second.
    const pinned = packMany(s.container, s.types, {
      keepUpright: false,
      mode: 'even',
      allocation: [{ small: 15 }],
    })
    expect(perType(pinned, 0, 'small')).toBe(15)
    expect(perType(pinned, 1, 'small')).toBe(45)
    expect(pinned.stats.placed).toBe(138)
    expect(multiViolation(s, pinned)).toBeNull()
  })

  it('never puts more in a container than is left, or than fits', () => {
    const s = exampleScenario()
    const greedy = packMany(s.container, s.types, {
      keepUpright: false,
      // Far more than the order holds, and more than one container can take.
      allocation: [{ small: 9999, pallet: 9999 }],
    })
    const first = greedy.containers[0]!
    expect(first.placements.filter((p) => p.typeId === 'small').length).toBeLessThanOrEqual(60)
    expect(first.placements.filter((p) => p.typeId === 'pallet').length).toBeLessThanOrEqual(12)
    expect(greedy.stats.placed).toBe(138)
    expect(multiViolation(s, greedy)).toBeNull()
  })

  it('pins the later containers too, and leaves the others to the mode', () => {
    const s = exampleScenario()
    const r = packMany(s.container, s.types, {
      keepUpright: false,
      mode: 'even',
      allocation: [undefined, { crate: 0 }],
    })
    expect(r.containers[1]!.placements.filter((p) => p.typeId === 'crate')).toHaveLength(0)
    // The crates it would have held move on to a third container.
    expect(r.containers.length).toBeGreaterThan(2)
    expect(r.stats.placed).toBe(138)
    expect(multiViolation(s, r)).toBeNull()
  })

  it('keeps every invariant on random scenarios', () => {
    const random = mulberry32(7)
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
    for (let i = 0; i < 60; i++) {
      const container = { l: int(5, 30), w: int(5, 30), h: int(5, 30) }
      const types = Array.from({ length: int(1, 4) }, (_, k) =>
        boxType(`t${k}`, int(1, 20), int(1, 20), int(1, 20), int(1, 12)),
      )
      const s: Scenario = { container, types, keepUpright: random() < 0.3 }
      const r = run(s, i % 3 === 0 ? 60 : 0)
      expect(multiViolation(s, r)).toBeNull()
      if (r.status === 'fits') expect(r.unplaced).toEqual({})
    }
  })

  it('leaves the single-container result of a fitting mix untouched', () => {
    const s = mixedScenario()
    const r = run(s, 400)
    expect(r.containers).toHaveLength(1)
    expect(r.runs).toBe(1)
    expect(r.containers[0]!.placements).toEqual(pack(s.container, s.types).placements)
  })
})

describe('evenShare', () => {
  const types = [boxType('a', 1, 1, 1, 0), boxType('b', 1, 1, 1, 0), boxType('c', 1, 1, 1, 0)]

  it('splits what is left into equal shares of every type', () => {
    expect(evenShare(types, { a: 10, b: 10, c: 10 }, 2)).toEqual({ a: 5, b: 5, c: 5 })
    expect(evenShare(types, { a: 30, b: 0, c: 0 }, 3)).toEqual({ a: 10, b: 0, c: 0 })
  })

  it('hands out the odd boxes by largest remainder, one each', () => {
    const share = evenShare(types, { a: 1, b: 1, c: 1 }, 2)
    expect(Object.values(share).reduce((x, y) => x + y)).toBe(2)
    expect(Object.values(share).every((n) => n <= 1)).toBe(true)
    // 7 boxes over 2 containers: 4 here, and a takes the larger remainder.
    expect(evenShare(types, { a: 5, b: 1, c: 1 }, 2)).toEqual({ a: 3, b: 1, c: 0 })
  })

  it('gives the last container everything that is left', () => {
    expect(evenShare(types, { a: 3, b: 2, c: 0 }, 1)).toEqual({ a: 3, b: 2, c: 0 })
    expect(evenShare(types, { a: 3, b: 2, c: 0 }, 0)).toEqual({ a: 3, b: 2, c: 0 })
  })

  it('never hands out more of a type than is left, or more than the share', () => {
    const random = mulberry32(3)
    for (let i = 0; i < 200; i++) {
      const remaining = {
        a: Math.floor(random() * 40),
        b: Math.floor(random() * 40),
        c: Math.floor(random() * 40),
      }
      const left = 1 + Math.floor(random() * 5)
      const share = evenShare(types, remaining, left)
      const total = remaining.a + remaining.b + remaining.c
      const given = share.a! + share.b! + share.c!
      for (const id of ['a', 'b', 'c'] as const)
        expect(share[id]!).toBeLessThanOrEqual(remaining[id])
      expect(given).toBe(left <= 1 ? total : Math.min(total, Math.ceil(total / left)))
    }
  })
})
