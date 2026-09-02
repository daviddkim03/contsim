import { describe, expect, it } from 'vitest'
import { optimize } from '../../src/core'
import { buildReport, formatTimestamp } from '../../src/ui/report'
import {
  DEFAULT_OPTIMIZE,
  DEFAULT_VIEW,
  derive,
  edits,
  exampleDraft,
  type AppState,
  type Draft,
} from '../../src/ui/state'
import type { Cell } from '../../src/ui/xlsx'

const now = new Date(2026, 8, 2, 14, 5, 59)

function stateOf(draft: Draft, patch: Partial<AppState> = {}): AppState {
  return { draft, derived: derive(draft), view: DEFAULT_VIEW, optimize: DEFAULT_OPTIMIZE, ...patch }
}

/** The Summary sheet as a lookup from item to value. */
const summaryOf = (rows: Cell[][]) => Object.fromEntries(rows.map(([k, v]) => [String(k), v]))

describe('formatTimestamp', () => {
  it('is local time to the minute', () => {
    expect(formatTimestamp(now)).toBe('2026-09-02 14:05')
    expect(formatTimestamp(new Date(2026, 0, 9, 8, 3))).toBe('2026-01-09 08:03')
  })
})

describe('buildReport', () => {
  it('returns null while the inputs are invalid', () => {
    expect(buildReport(stateOf(edits.setContainer(exampleDraft(), 'l', 'abc')))).toBeNull()
  })

  it('summarizes the example scenario, which does not fit', () => {
    const state = stateOf(exampleDraft())
    const workbook = buildReport(state, now)!
    expect(workbook.sheets.map((s) => s.name)).toEqual(['Summary', 'Boxes', 'Placements'])
    const [summary, boxes, placements] = workbook.sheets
    expect(summary!.header).toEqual(['Item', 'Value'])
    expect(summaryOf(summary!.rows)).toMatchObject({
      Exported: '2026-09-02 14:05',
      Status: "Doesn't fit",
      Details: expect.stringContaining('Placed 123 of 138.'),
      Unit: 'in',
      'Container length (in)': 232,
      'Container width (in)': 92,
      'Container height (in)': 94,
      'Container volume (cu ft)': 1161.07,
      'Keep boxes upright': 'No',
      'Boxes requested': 138,
      'Boxes placed': 123,
      'Boxes left out': 15,
      Fill: { percent: state.derived.result!.stats.fill },
      'Placements sheet': expect.stringContaining('Lengths are in inches.'),
    })
    expect(summaryOf(summary!.rows)).not.toHaveProperty('Optimizer runs')
    expect(boxes!.header.slice(0, 6)).toEqual([
      '#',
      'Box',
      'Color',
      'Length (in)',
      'Width (in)',
      'Height (in)',
    ])
    expect(placements!.header).toEqual([
      '#',
      'Box',
      'X (in)',
      'Y (in)',
      'Z (in)',
      'Length (in)',
      'Width (in)',
      'Height (in)',
      'Top (in)',
    ])
  })

  it('lists every box type with requested, placed and left-out counts', () => {
    const state = stateOf(exampleDraft())
    const boxes = buildReport(state, now)!.sheets[1]!.rows
    expect(boxes).toHaveLength(5)
    // 48 x 40 x 48 in = 92,160 cu in = 53.33 cu ft each.
    expect(boxes[0]!.slice(0, 7)).toEqual([1, 'Pallet box', '#f59e0b', 48, 40, 48, 12])
    expect(boxes[0]![9]).toBe(53.33)
    expect(boxes[2]!.slice(6, 9)).toEqual([40, 25, 15])
    const sum = (column: number) => boxes.reduce((n, row) => n + (row[column] as number), 0)
    expect(sum(6)).toBe(138)
    expect(sum(7)).toBe(123)
    expect(sum(8)).toBe(15)
    const shares = boxes.map((row) => (row[11] as { percent: number }).percent)
    expect(shares.reduce((a, b) => a + b)).toBeCloseTo(state.derived.result!.stats.fill, 6)
  })

  it('lists every placement inside the container in placement order', () => {
    const state = stateOf(exampleDraft())
    const placements = buildReport(state, now)!.sheets[2]!.rows
    expect(placements).toHaveLength(123)
    expect(placements[0]!.slice(0, 5)).toEqual([1, 'Pallet box', 0, 0, 0])
    placements.forEach((row, i) => {
      const [n, , x, y, z, dx, dy, dz, top] = row as number[]
      expect(n).toBe(i + 1)
      expect(top).toBe(z! + dz!)
      expect(x! + dx!).toBeLessThanOrEqual(232)
      expect(y! + dy!).toBeLessThanOrEqual(92)
      expect(z! + dz!).toBeLessThanOrEqual(94)
    })
  })

  it('reports decimals in the chosen unit, unscaled', () => {
    let draft = edits.setUnit(exampleDraft(), 'cm')
    draft = edits.setContainer(draft, 'l', '232.5')
    draft = edits.setKeepUpright(draft, true)
    const workbook = buildReport(stateOf(draft), now)!
    const summary = summaryOf(workbook.sheets[0]!.rows)
    expect(summary).toMatchObject({
      Unit: 'cm',
      'Container length (cm)': 232.5,
      // 232.5 x 92 x 94 cm = 2,010,660 cu cm = 2.011 cu m.
      'Container volume (m³)': 2.011,
      'Keep boxes upright': 'Yes',
      'Placements sheet': expect.stringContaining('Lengths are in centimetres.'),
    })
    expect(workbook.sheets[1]!.header[3]).toBe('Length (cm)')
    expect(workbook.sheets[1]!.header[9]).toBe('Volume each (m³)')
    expect(workbook.sheets[2]!.header[2]).toBe('X (cm)')
  })

  it('describes the Optimize proposal while one is shown', () => {
    const state = stateOf(exampleDraft())
    const scenario = state.derived.scenario!
    const result = optimize(scenario.container, scenario.types, {
      keepUpright: false,
      objective: 'keep-most-boxes',
    })
    const kept = Object.values(result.kept).reduce((a, b) => a + b, 0)
    const workbook = buildReport(
      { ...state, optimize: { ...DEFAULT_OPTIMIZE, status: 'done', result, runs: result.runs } },
      now,
    )!
    const summary = summaryOf(workbook.sheets[0]!.rows)
    expect(summary).toMatchObject({
      Status: 'Optimize proposal',
      Details: `Keeps ${kept} of 138 boxes with the "Keep most boxes" objective. Not applied yet; the requested quantities do not fit.`,
      'Boxes requested': 138,
      'Boxes placed': kept,
      'Boxes left out': 138 - kept,
      'Optimizer runs': result.runs,
    })
    expect(summary['Optimizer time (ms)']).toBeTypeOf('number')
    const boxes = workbook.sheets[1]!.rows
    expect(boxes.map((row) => row[7])).toEqual(scenario.types.map((t) => result.kept[t.id]))
    expect(workbook.sheets[2]!.rows).toHaveLength(result.result.placements.length)
  })
})
