import { describe, expect, it } from 'vitest'
import { optimize, type OptimizeProgress } from '../../src/core/optimizer'
import { pack } from '../../src/core/packer'
import type { Objective, Scenario } from '../../src/core/types'
import { exampleScenario, mixedScenario } from '../../src/scenarios'
import { boxType, overfull, oversize, packingViolation } from './fixtures'

const run = (s: Scenario, objective: Objective = 'keep-most-boxes', maxRuns?: number) =>
  optimize(s.container, s.types, { objective, maxRuns })

const total = (q: Record<string, number>) => Object.values(q).reduce((a, b) => a + b, 0)

function keptScenario(s: Scenario, kept: Record<string, number>): Scenario {
  return { ...s, types: s.types.map((t) => ({ ...t, qty: kept[t.id] ?? 0 })) }
}

describe('optimize', () => {
  it('returns no reductions when everything fits', () => {
    const s = mixedScenario()
    const r = run(s)
    expect(r.removed).toEqual({})
    expect(r.result.status).toBe('fits')
    expect(total(r.kept)).toBe(69)
    expect(r.runs).toBe(1)
  })

  it('finds a fitting plan for the example and keeps at least as much as plain packing', () => {
    const s = exampleScenario()
    const plain = pack(s.container, s.types)
    const r = run(s)
    expect(r.result.status).toBe('fits')
    expect(packingViolation(keptScenario(s, r.kept), r.result)).toBeNull()
    expect(total(r.kept)).toBeGreaterThanOrEqual(plain.stats.placed)
    expect(total(r.kept)).toBeLessThan(138)
    for (const t of s.types) {
      expect(r.kept[t.id]).toBeLessThanOrEqual(t.qty)
      expect((r.kept[t.id] ?? 0) + (r.removed[t.id] ?? 0)).toBe(t.qty)
    }
    expect(r.runs).toBeLessThanOrEqual(200)
  })

  it('is deterministic', () => {
    const s = exampleScenario()
    const a = run(s)
    const b = run(s)
    expect(b.kept).toEqual(a.kept)
    expect(b.runs).toBe(a.runs)
    expect(b.result.placements).toEqual(a.result.placements)
  })

  it('handles requests that are provably impossible', () => {
    const r = run(overfull)
    expect(r.result.status).toBe('fits')
    expect(r.kept.unit).toBe(64)
    expect(r.removed.unit).toBe(6)
    expect(packingViolation(keptScenario(overfull, r.kept), r.result)).toBeNull()
  })

  it('drops a box type entirely when it can never fit', () => {
    const s: Scenario = {
      ...oversize,
      types: [...oversize.types, boxType('cube', 5, 5, 5, 4)],
    }
    const r = run(s)
    expect(r.kept).toEqual({ rod: 0, cube: 4 })
    expect(r.removed).toEqual({ rod: 1 })
    expect(r.result.status).toBe('fits')
  })

  it('keep-most-boxes and keep-most-volume prefer different plans', () => {
    // One 10x10x10 box fills the container alone (volume 1000, count 1);
    // seven 5x5x5 boxes fit together (volume 875, count 7).
    const s: Scenario = {
      container: { l: 10, w: 10, h: 10 },
      types: [boxType('big', 10, 10, 10, 1), boxType('small', 5, 5, 5, 7)],
    }
    expect(run(s, 'keep-most-boxes').kept).toEqual({ big: 0, small: 7 })
    expect(run(s, 'keep-most-volume').kept).toEqual({ big: 1, small: 0 })
  })

  it('cut-evenly reduces every type by the same fraction, then adds back', () => {
    // Only eight 5x5x5 cubes fit; twenty are requested across two types.
    const s: Scenario = {
      container: { l: 10, w: 10, h: 10 },
      types: [boxType('a', 5, 5, 5, 10), boxType('b', 5, 5, 5, 10)],
    }
    const even = run(s, 'cut-evenly')
    expect(even.kept).toEqual({ a: 4, b: 4 })
    expect(even.result.status).toBe('fits')
    expect(total(run(s, 'keep-most-boxes').kept)).toBe(8)
  })

  it('reports progress and stops early when asked, still returning a valid plan', () => {
    const s = exampleScenario()
    const seen: OptimizeProgress[] = []
    const r = optimize(s.container, s.types, {
      objective: 'keep-most-boxes',
      onProgress: (p) => {
        seen.push(p)
        return p.runs < 5
      },
    })
    expect(seen.length).toBe(5)
    expect(seen[0]).toMatchObject({ runs: 1, maxRuns: 200, requested: 138 })
    expect(r.runs).toBe(5)
    expect(r.result.status).toBe('fits')
    expect(packingViolation(keptScenario(s, r.kept), r.result)).toBeNull()
  })

  it('respects maxRuns', () => {
    const r = run(exampleScenario(), 'keep-most-boxes', 12)
    expect(r.runs).toBeLessThanOrEqual(12)
    expect(r.result.status).toBe('fits')
  })

  it('finishes the example quickly', () => {
    const r = run(exampleScenario())
    expect(r.ms).toBeLessThan(3000)
  })
})
