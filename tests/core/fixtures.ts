import { insideContainer, overlaps } from '../../src/core/geometry'
import type { BoxType, Container, PackResult, Scenario } from '../../src/core/types'

export const boxType = (
  id: string,
  l: number,
  w: number,
  h: number,
  qty: number,
  extra: Partial<BoxType> = {},
): BoxType => ({
  id,
  name: `Box ${id.toUpperCase()}`,
  dims: { l, w, h },
  qty,
  color: '#888888',
  ...extra,
})

const scenario = (container: Container, types: BoxType[]): Scenario => ({ container, types })

export const tiny = scenario({ l: 2, w: 2, h: 2 }, [boxType('unit', 1, 1, 1, 8)])
export const cube27 = scenario({ l: 3, w: 3, h: 3 }, [boxType('unit', 1, 1, 1, 27)])
export const rotation = scenario({ l: 1, w: 1, h: 10 }, [boxType('rod', 10, 1, 1, 1)])
export const overfull = scenario({ l: 4, w: 4, h: 4 }, [boxType('unit', 1, 1, 1, 70)])
export const oversize = scenario({ l: 10, w: 10, h: 10 }, [boxType('rod', 11, 1, 1, 1)])
/** Four 3x2x1 slabs fit in 5x5x1 as a pinwheel around a unit cube, but first fit cannot find it. */
export const pinwheel = scenario({ l: 5, w: 5, h: 1 }, [
  boxType('slab', 3, 2, 1, 4),
  boxType('unit', 1, 1, 1, 1),
])
export const perf300 = scenario({ l: 100, w: 100, h: 100 }, [
  boxType('a', 10, 10, 10, 100),
  boxType('b', 20, 10, 10, 50),
  boxType('c', 15, 15, 15, 50),
  boxType('d', 5, 5, 5, 100),
])

/**
 * Returns a description of the first packing invariant that `result` breaks
 * for `scenario`, or null when the packing is valid.
 */
export function packingViolation(scenario: Scenario, result: PackResult): string | null {
  const { container, types } = scenario
  const byId = new Map(types.map((t) => [t.id, t]))
  const sorted = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => x - y).join(',')

  for (const p of result.placements) {
    const t = byId.get(p.typeId)
    if (!t) return `unknown type ${p.typeId}`
    if (!insideContainer(p, p, container)) return `outside the container: ${JSON.stringify(p)}`
    if (sorted(p.dx, p.dy, p.dz) !== sorted(t.dims.l, t.dims.w, t.dims.h)) {
      return `not an orientation of ${t.id}: ${JSON.stringify(p)}`
    }
    if (t.fragile) {
      if (p.dz !== t.dims.h) return `fragile but not upright: ${JSON.stringify(p)}`
      const onAWall =
        p.x === 0 || p.y === 0 || p.x + p.dx === container.l || p.y + p.dy === container.w
      if (!onAWall) return `fragile but not against a wall: ${JSON.stringify(p)}`
      for (const other of result.placements) {
        if (other === p) continue
        const stacked =
          other.z >= p.z + p.dz &&
          other.x < p.x + p.dx &&
          p.x < other.x + other.dx &&
          other.y < p.y + p.dy &&
          p.y < other.y + other.dy
        if (stacked) return `box on top of fragile ${t.id}: ${JSON.stringify(other)}`
      }
    }
  }

  const ps = result.placements
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (overlaps(ps[i]!, ps[j]!))
        return `overlap: ${JSON.stringify(ps[i])} and ${JSON.stringify(ps[j])}`
    }
  }

  for (const t of types) {
    const placed = ps.filter((p) => p.typeId === t.id).length
    const unplaced = result.unplaced[t.id] ?? 0
    if (placed + unplaced !== t.qty) {
      return `${t.id}: placed ${placed} + unplaced ${unplaced} != requested ${t.qty}`
    }
  }

  const requested = types.reduce((n, t) => n + t.qty, 0)
  if (result.stats.placed !== ps.length) return 'stats.placed does not match placements'
  if (result.stats.requested !== requested) return 'stats.requested does not match the types'
  if (result.status === 'impossible') {
    if (ps.length > 0) return 'impossible but has placements'
    if (!result.impossibility) return 'impossible without a reason'
  } else {
    const expected = ps.length === requested ? 'fits' : 'not-found'
    if (result.status !== expected) return `status ${result.status}, expected ${expected}`
    if (result.impossibility) return 'has a reason although it is not impossible'
  }
  return null
}
