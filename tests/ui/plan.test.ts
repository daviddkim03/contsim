import { describe, expect, it } from 'vitest'
import type { Container, Placement } from '../../src/core'
import { PLAN_COLUMNS, sideView, topView, type Plan } from '../../src/ui/plan'

const container: Container = { l: 40, w: 20, h: 10 }
const place = (
  typeId: string,
  [x, y, z]: [number, number, number],
  [dx, dy, dz]: [number, number, number],
): Placement => ({ typeId, x, y, z, dx, dy, dz })

const colourOf = (typeId: string) => (typeId === 'a' ? '#ff0000' : '#0000ff')
/** The grid as one string per row, a letter per colour: "." is empty floor. */
const draw = (plan: Plan) =>
  plan.grid.map((row) => row.map((c) => (c === null ? '.' : c === '#ff0000' ? 'a' : 'b')).join(''))

describe('topView', () => {
  it('lays length across and width down, at the asked width', () => {
    const plan = topView(container, [], colourOf, 8)
    expect(plan.columns).toBe(8)
    expect(plan.cell).toBe(5)
    // 20 wide over 5 units a cell.
    expect(plan.rows).toBe(4)
    expect(draw(plan)).toEqual(['........', '........', '........', '........'])
  })

  it('paints a box over the cells it covers and leaves the floor empty', () => {
    const plan = topView(container, [place('a', [0, 0, 0], [20, 10, 5])], colourOf, 8)
    expect(draw(plan)).toEqual(['aaaa....', 'aaaa....', '........', '........'])
  })

  it('shows what is on top, because a higher box is painted last', () => {
    const low = place('a', [0, 0, 0], [40, 20, 5])
    const high = place('b', [0, 0, 5], [20, 20, 5])
    const plan = topView(container, [high, low], colourOf, 8)
    expect(draw(plan)).toEqual(Array(4).fill('bbbbaaaa'))
  })

  it('defaults to a width worth reading', () => {
    expect(topView(container, [], colourOf).columns).toBe(PLAN_COLUMNS)
  })
})

describe('sideView', () => {
  it('lays length across and height up the page', () => {
    // Row 0 is the roof, so a box on the floor is drawn on the bottom row.
    const plan = sideView(container, [place('a', [0, 0, 0], [20, 20, 5])], colourOf, 8)
    expect(plan.rows).toBe(2)
    expect(draw(plan)).toEqual(['........', 'aaaa....'])
  })

  it('stacks upwards', () => {
    const floor = place('a', [0, 0, 0], [40, 20, 5])
    const top = place('b', [0, 0, 5], [20, 20, 5])
    expect(draw(sideView(container, [floor, top], colourOf, 8))).toEqual(['bbbb....', 'aaaaaaaa'])
  })

  it('shows the near row, because a box further back is painted first', () => {
    const back = place('a', [0, 0, 0], [40, 10, 10])
    const front = place('b', [0, 10, 0], [20, 10, 10])
    expect(draw(sideView(container, [front, back], colourOf, 8))).toEqual(Array(2).fill('bbbbaaaa'))
  })
})

describe('both views', () => {
  it('keeps a thin box visible instead of rounding it away', () => {
    const sliver = place('a', [0, 0, 0], [1, 1, 1])
    expect(draw(topView(container, [sliver], colourOf, 8))[0]![0]).toBe('a')
    expect(draw(sideView(container, [sliver], colourOf, 8))[1]![0]).toBe('a')
  })

  it('never paints outside the container', () => {
    const full = place('a', [0, 0, 0], [40, 20, 10])
    for (const plan of [
      topView(container, [full], colourOf, 8),
      sideView(container, [full], colourOf, 8),
    ]) {
      expect(plan.grid).toHaveLength(plan.rows)
      for (const row of plan.grid) {
        expect(row).toHaveLength(plan.columns)
        expect(row.every((c) => c === '#ff0000')).toBe(true)
      }
    }
  })
})
