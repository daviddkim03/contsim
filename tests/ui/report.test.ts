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
import type { Block, Cell, Sheet } from '../../src/ui/xlsx'

const now = new Date(2026, 8, 2, 14, 5, 59)

function stateOf(draft: Draft, patch: Partial<AppState> = {}): AppState {
  return { draft, derived: derive(draft), view: DEFAULT_VIEW, optimize: DEFAULT_OPTIMIZE, ...patch }
}

/** The settings block at the top of a sheet, as a lookup from label to value. */
const settingsOf = (sheet: Sheet) =>
  Object.fromEntries(sheet.rows.slice(0, blankAfter(sheet.rows, 0)).map(([k, v]) => [String(k), v]))

/** The index of the first blank row at or after `from`. */
function blankAfter(rows: Cell[][], from: number): number {
  for (let r = from; r < rows.length; r++) if (rows[r]!.length === 0) return r
  return rows.length
}

/** The box table: the header row and the rows under it, up to the next blank. */
function tableOf(sheet: Sheet): Cell[][] {
  const start = sheet.rows.findIndex((row) => row[1] === 'Box')
  return sheet.rows.slice(start, blankAfter(sheet.rows, start))
}

/** The rows of one drawing, by the label above it. */
function drawingOf(sheet: Sheet, label: string): Cell[][] {
  const start = sheet.rows.findIndex((row) => String(row[0] ?? '').startsWith(label))
  expect(start, `no drawing labelled ${label}`).toBeGreaterThan(0)
  return sheet.rows.slice(start + 1, blankAfter(sheet.rows, start + 1))
}

describe('formatTimestamp', () => {
  it('is local time to the minute', () => {
    expect(formatTimestamp(now)).toBe('2026-09-02 14:05')
    expect(formatTimestamp(new Date(2026, 0, 9, 8, 3))).toBe('2026-01-09 08:03')
  })
})

describe('buildReport', () => {
  it('returns null while the inputs are invalid', () => {
    const draft = edits.setTypeField(exampleDraft(), '18', 'qty', 'abc')
    expect(buildReport(stateOf(draft))).toBeNull()
  })

  it('writes one sheet per container and nothing else', () => {
    const state = stateOf(exampleDraft())
    const result = state.derived.result!
    expect(result.containers.length).toBeGreaterThan(1)
    const workbook = buildReport(state, now)!
    expect(workbook.sheets.map((s) => s.name)).toEqual(
      result.containers.map((_, i) => `Container ${i + 1}`),
    )
  })

  it('opens each sheet with the settings and totals of that container', () => {
    const state = stateOf(exampleDraft())
    const result = state.derived.result!
    const workbook = buildReport(state, now)!
    workbook.sheets.forEach((sheet, i) => {
      expect(settingsOf(sheet)).toMatchObject({
        [`Container ${i + 1} of ${result.containers.length}`]: '2026-09-02 14:05',
        'Container type': '20 ft',
        'Container size (in)': '232.2 × 92.6 × 94.2',
        Unit: 'in',
        'Weight unit': 'kg',
        'Payload per container': 11000,
        'Loading mode': 'Even',
        Boxes: result.containers[i]!.placements.length,
        Fill: { percent: result.containers[i]!.stats.fill },
      })
    })
  })

  it('lists the boxes in that container, and only those', () => {
    const state = stateOf(exampleDraft())
    const result = state.derived.result!
    const workbook = buildReport(state, now)!
    let total = 0
    workbook.sheets.forEach((sheet, i) => {
      const [header, ...rows] = tableOf(sheet)
      expect(header).toEqual([
        null,
        'Box',
        'Size (in)',
        'Weight each (kg)',
        'Weight (kg)',
        'Fragile',
        'Count',
      ])
      const placements = result.containers[i]!.placements
      const nameOf = (typeId: string) =>
        state.derived.scenario!.types.find((t) => t.id === typeId)!.name
      for (const row of rows) {
        const count = placements.filter((p) => nameOf(p.typeId) === row[1]).length
        expect(row[6]).toBe(count)
        expect(count).toBeGreaterThan(0)
        // The swatch matches the colour the viewer and the legend use.
        expect((row[0] as Block).fill).toMatch(/^#[0-9a-f]{6}$/)
        total += count
      }
      expect(rows.reduce((n, row) => n + (row[6] as number), 0)).toBe(placements.length)
    })
    expect(total).toBe(140)
  })

  it('draws a top view and a side view of every container', () => {
    const state = stateOf(exampleDraft())
    const workbook = buildReport(state, now)!
    for (const sheet of workbook.sheets) {
      const top = drawingOf(sheet, 'Top view - length 232.2 × width 92.6 in')
      const side = drawingOf(sheet, 'Side view - length 232.2 × height 94.2 in')
      // 232.2 x 92.6 in across 80 columns: 80 x 32 cells, and 80 x 32 for the
      // side view because the container is nearly as tall as it is wide.
      expect(top).toHaveLength(32)
      expect(side).toHaveLength(32)
      for (const row of [...top, ...side]) {
        // Seven table columns are left empty so the drawing starts clear of them.
        expect(row).toHaveLength(87)
        expect(row.slice(0, 7)).toEqual(Array(7).fill(null))
        for (const cell of row.slice(7)) expect((cell as Block).fill).toMatch(/^#[0-9a-f]{6}$/)
      }
      // A drawing cell is a pixel: narrow columns and short rows.
      expect(sheet.width).toBeLessThan(2)
      expect(Object.keys(sheet.heights!)).toHaveLength(64)
    }
  })

  it('paints what is packed and leaves the rest as floor', () => {
    const state = stateOf(exampleDraft())
    const workbook = buildReport(state, now)!
    const sheet = workbook.sheets[0]!
    const colours = new Set(
      drawingOf(sheet, 'Top view').flatMap((row) =>
        row.slice(7).map((cell) => (cell as Block).fill),
      ),
    )
    const used = new Set(
      tableOf(sheet)
        .slice(1)
        .map((row) => (row[0] as Block).fill),
    )
    for (const colour of used) expect(colours).toContain(colour)
    // Everything drawn is either a box in the table or the empty floor.
    for (const colour of colours) expect(used.has(colour) || colour === '#e2e8f0').toBe(true)
  })

  it('reports in the chosen units', () => {
    const draft = edits.setWeightUnit(edits.setUnit(exampleDraft(), 'cm'), 'lb')
    const sheet = buildReport(stateOf(draft), now)!.sheets[0]!
    expect(settingsOf(sheet)).toMatchObject({
      Unit: 'cm',
      'Weight unit': 'lb',
      'Container size (cm)': '589.8 × 235.2 × 239.3',
      'Payload per container': 24251,
    })
    expect(tableOf(sheet)[0]).toContain('Size (cm)')
    expect(tableOf(sheet)[0]).toContain('Weight each (lb)')
    expect(settingsOf(sheet)['Volume (m³)']).toBeGreaterThan(0)
  })

  it('marks the fragile box types', () => {
    const draft = edits.setFragile(exampleDraft(), '3036', true)
    const sheet = buildReport(stateOf(draft), now)!.sheets[0]!
    const rows = tableOf(sheet).slice(1)
    expect(rows.find((row) => row[1] === '3036')![5]).toBe('Yes')
    expect(rows.filter((row) => row[5] === 'Yes')).toHaveLength(1)
  })

  it('reports the optimized packing once it is in', () => {
    const state = stateOf(exampleDraft())
    const scenario = state.derived.scenario!
    const optimized = packMany(scenario.container, scenario.types, { optimizeRuns: 400 })
    const workbook = buildReport(
      { ...state, optimize: { ...DEFAULT_OPTIMIZE, status: 'done', result: optimized } },
      now,
    )!
    expect(workbook.sheets).toHaveLength(optimized.containers.length)
    const boxes = workbook.sheets.reduce(
      (n, sheet) =>
        n +
        tableOf(sheet)
          .slice(1)
          .reduce((m, row) => m + (row[6] as number), 0),
      0,
    )
    expect(boxes).toBe(optimized.stats.placed)
  })
})
