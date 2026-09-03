import { describe, expect, it } from 'vitest'
import { packMany, type MultiPackProgress, type MultiPackResult } from '../../src/core/multi'
import { mulberry32 } from '../../src/core/ordering'
import { pack } from '../../src/core/packer'
import type { Scenario } from '../../src/core/types'
import { exampleScenario, mixedScenario } from '../../src/scenarios'
import { boxType, overfull, oversize, packingViolation, rotation, tiny } from './fixtures'

const run = (s: Scenario, optimizeRuns = 0, maxContainers?: number) =>
  packMany(s.container, s.types, { keepUpright: s.keepUpright, optimizeRuns, maxContainers })

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
