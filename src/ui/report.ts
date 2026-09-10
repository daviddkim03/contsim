/**
 * The Excel export: one sheet per container, each holding what that container
 * carries and what it looks like.
 *
 * The sheet opens with the settings and totals, then the boxes with their
 * count, then a top view and a side view drawn as coloured cells
 * (src/ui/plan.ts). Import reads the same sheets back, so the labels in the
 * settings block and the box table are part of the format
 * (src/ui/orderImport.ts).
 */

import type { Placement } from '../core'
import { PLAN_COLUMNS, sideView, topView, type Plan } from './plan'
import { containerTypeName } from './presets'
import { shownResult, type AppState } from './state'
import { formatNumber, fromGrams, volumeOf } from './units'
import { block, percent, type Cell, type Sheet, type Workbook } from './xlsx'

export const EXCEL_FILENAME = 'contsim-packing.xlsx'

/** The empty floor of a container, so its outline reads against the page. */
const FLOOR = '#e2e8f0'
/** Widths for the table, in characters; every column after them draws the plan. */
const TABLE_WIDTHS = [3, 20, 20, 15, 14, 8, 8]
/** Narrow enough that a cell reads as a pixel; the row height matches it. */
const PLAN_CELL_WIDTH = 1.3
const PLAN_ROW_HEIGHT = 6.75

const pad = (n: number) => String(n).padStart(2, '0')

/** Local date and time, minute precision: "2026-09-02 14:05". */
export function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Builds the workbook, or null while the inputs are invalid. */
export function buildReport(state: AppState, now: Date = new Date()): Workbook | null {
  const { draft, derived } = state
  const { scenario, scale } = derived
  const result = shownResult(state)
  if (!result || !scenario) return null

  const unit = draft.unit
  const weightUnit = draft.weightUnit
  // The same rounding the app shows, so the sheet and the screen agree and a
  // converted round number does not arrive as 24251.001.
  const weight = (grams: number) => {
    const value = fromGrams(grams, weightUnit)
    return Number(value.toFixed(value < 100 ? 2 : 0))
  }
  const volumeUnit = volumeOf(0, scale, unit).unit
  const volume = (int: number) => {
    const v = volumeOf(int, scale, unit)
    return Number(v.value.toFixed(v.decimals + 1))
  }
  const size = (l: number, w: number, h: number) =>
    `${formatNumber(l, scale)} × ${formatNumber(w, scale)} × ${formatNumber(h, scale)}`

  const container = scenario.container
  const types = new Map(scenario.types.map((t) => [t.id, t]))
  const colourOf = (typeId: string) => types.get(typeId)?.color ?? '#888888'
  const { maxWeight } = result.stats

  const sheets: Sheet[] = result.containers.map((packing, i) => {
    const rows: Cell[][] = [
      [`Container ${i + 1} of ${result.containers.length}`, formatTimestamp(now)],
      ['Container type', containerTypeName(draft.containerType)],
      [`Container size (${unit})`, size(container.l, container.w, container.h)],
      ['Unit', unit],
      ['Weight unit', weightUnit],
      ['Payload per container', maxWeight > 0 ? weight(maxWeight) : 'not set'],
      ['Loading mode', draft.mode === 'even' ? 'Even' : 'Optimize'],
      ['Boxes', packing.placements.length],
      ['Fill', percent(packing.stats.fill)],
      [`Volume (${volumeUnit})`, volume(packing.stats.placedVolume)],
      [`Weight (${weightUnit})`, weight(packing.stats.weight)],
      [],
      [
        null,
        'Box',
        `Size (${unit})`,
        `Weight each (${weightUnit})`,
        `Weight (${weightUnit})`,
        'Fragile',
        'Count',
      ],
    ]
    for (const t of scenario.types) {
      const n = packing.placements.filter((p) => p.typeId === t.id).length
      if (n === 0) continue
      rows.push([
        block(t.color),
        t.name,
        size(t.dims.l, t.dims.w, t.dims.h),
        t.weight ? weight(t.weight) : null,
        t.weight ? weight(t.weight * n) : null,
        t.fragile ? 'Yes' : 'No',
        n,
      ])
    }
    rows.push([])

    const heights: Record<number, number> = {}
    const draw = (label: string, plan: Plan) => {
      rows.push([label])
      for (const line of plan.grid) {
        heights[rows.length] = PLAN_ROW_HEIGHT
        rows.push([
          ...Array<Cell>(TABLE_WIDTHS.length).fill(null),
          ...line.map((colour) => block(colour ?? FLOOR)),
        ])
      }
      rows.push([])
    }
    const placements = packing.placements as readonly Placement[]
    draw(
      `Top view - length ${formatNumber(container.l, scale)} × width ${formatNumber(container.w, scale)} ${unit}`,
      topView(container, placements, colourOf, PLAN_COLUMNS),
    )
    draw(
      `Side view - length ${formatNumber(container.l, scale)} × height ${formatNumber(container.h, scale)} ${unit}`,
      sideView(container, placements, colourOf, PLAN_COLUMNS),
    )

    return {
      name: `Container ${i + 1}`,
      rows,
      widths: TABLE_WIDTHS,
      width: PLAN_CELL_WIDTH,
      heights,
    }
  })

  return { sheets: sheets.length > 0 ? sheets : [emptySheet(now)] }
}

/** Nothing is packed, but a workbook needs a sheet. */
function emptySheet(now: Date): Sheet {
  return {
    name: 'Container 1',
    rows: [
      ['contsim packing', formatTimestamp(now)],
      ['Boxes', 0],
    ],
    widths: TABLE_WIDTHS,
  }
}
