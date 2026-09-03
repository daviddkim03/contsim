import { describe, expect, it } from 'vitest'
import { packMany } from '../../src/core'
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
    const draft = edits.setTypeField(exampleDraft(), '36', 'qty', 'abc')
    expect(buildReport(stateOf(draft))).toBeNull()
  })

  it('summarizes the example order, which needs more than one container', () => {
    const state = stateOf(exampleDraft())
    const result = state.derived.result!
    const workbook = buildReport(state, now)!
    expect(workbook.sheets.map((s) => s.name)).toEqual([
      'Summary',
      'Containers',
      'Boxes',
      'Placements',
    ])
    const [summary, containers, boxes, placements] = workbook.sheets
    expect(summary!.header).toEqual(['Item', 'Value'])
    expect(summaryOf(summary!.rows)).toMatchObject({
      Exported: '2026-09-02 14:05',
      Status: `${result.containers.length} containers`,
      Details: expect.stringContaining('All 150 boxes placed in'),
      Unit: 'in',
      'Container type': '20 ft',
      'Container length (in)': 232.2,
      'Container width (in)': 92.6,
      'Container height (in)': 94.2,
      'Keep boxes upright': 'No',
      'Containers needed': result.containers.length,
      'Boxes requested': 150,
      'Boxes placed': 150,
      'Boxes left out': 0,
      'Fill, all containers': { percent: result.stats.fill },
      'Placements sheet': expect.stringContaining('Lengths are in inches.'),
    })
    expect(containers!.header).toEqual(['Container', 'Boxes', 'Fill', 'Placed volume (cu ft)'])
    expect(containers!.rows).toHaveLength(result.containers.length)
    expect(containers!.rows[0]!.slice(0, 3)).toEqual([
      1,
      result.containers[0]!.placements.length,
      { percent: result.containers[0]!.stats.fill },
    ])
    expect(boxes!.header.slice(0, 6)).toEqual([
      '#',
      'Box',
      'Color',
      'Length (in)',
      'Width (in)',
      'Height (in)',
    ])
    expect(placements!.header).toEqual([
      'Container',
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
    const boxes = buildReport(state, now)!.sheets[2]!.rows
    expect(boxes).toHaveLength(10)
    // A 36 in base cabinet: 36 x 24 x 34.5 in = 29,808 cu in = 17.25 cu ft.
    expect(boxes[0]!.slice(0, 9)).toEqual([1, '36', '#f59e0b', 36, 24, 34.5, 20, 20, 0])
    expect(boxes[0]![9]).toBe(17.25)
    const sum = (column: number) => boxes.reduce((n, row) => n + (row[column] as number), 0)
    expect(sum(6)).toBe(150)
    expect(sum(7)).toBe(150)
    expect(sum(8)).toBe(0)
    const shares = boxes.map((row) => (row[11] as { percent: number }).percent)
    expect(shares.reduce((a, b) => a + b)).toBeCloseTo(state.derived.result!.stats.fill, 6)
  })

  it('lists every placement with its container, inside the container', () => {
    const state = stateOf(exampleDraft())
    const result = state.derived.result!
    const placements = buildReport(state, now)!.sheets[3]!.rows
    expect(placements).toHaveLength(150)
    expect(placements[0]!.slice(0, 5)).toEqual([1, 1, 'P249624', 0, 0])
    const perContainer = result.containers.map((c) => c.placements.length)
    placements.forEach((row, i) => {
      const [container, n, , x, y, z, dx, dy, dz, top] = row as number[]
      const k = container! - 1
      expect(n).toBe(i + 1 - perContainer.slice(0, k).reduce((a, b) => a + b, 0))
      expect(top).toBe(z! + dz!)
      expect(x! + dx!).toBeLessThanOrEqual(232.2)
      expect(y! + dy!).toBeLessThanOrEqual(92.6)
      expect(z! + dz!).toBeLessThanOrEqual(94.2)
    })
  })

  it('reports in the chosen unit', () => {
    let draft = edits.setUnit(exampleDraft(), 'cm')
    draft = edits.setKeepUpright(draft, true)
    const workbook = buildReport(stateOf(draft), now)!
    const summary = summaryOf(workbook.sheets[0]!.rows)
    expect(summary).toMatchObject({
      Unit: 'cm',
      'Container length (cm)': 589.8,
      // 589.8 x 235.2 x 239.3 cm = 33,195,926 cu cm = 33.196 cu m.
      'Container volume, each (m³)': 33.196,
      'Keep boxes upright': 'Yes',
      'Placements sheet': expect.stringContaining('Lengths are in centimetres.'),
    })
    expect(workbook.sheets[2]!.header[3]).toBe('Length (cm)')
    expect(workbook.sheets[2]!.header[9]).toBe('Volume each (m³)')
    expect(workbook.sheets[3]!.header[3]).toBe('X (cm)')
  })

  it('reports the optimized packing once it is in', () => {
    const state = stateOf(exampleDraft())
    const scenario = state.derived.scenario!
    const optimized = packMany(scenario.container, scenario.types, {
      keepUpright: false,
      optimizeRuns: 400,
    })
    const workbook = buildReport(
      { ...state, optimize: { ...DEFAULT_OPTIMIZE, status: 'done', result: optimized } },
      now,
    )!
    expect(summaryOf(workbook.sheets[0]!.rows)['Containers needed']).toBe(
      optimized.containers.length,
    )
    expect(workbook.sheets[1]!.rows).toHaveLength(optimized.containers.length)
    expect(workbook.sheets[3]!.rows).toHaveLength(150)
  })
})
