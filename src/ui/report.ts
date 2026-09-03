/**
 * The Excel report: everything the screen shows about the current order and
 * its packing, as a workbook with four sheets.
 *
 * - Summary: status, container, totals, and how to read the other sheets.
 * - Containers: one row per container with its box count and fill.
 * - Boxes: one row per box type with requested, placed and left-out counts.
 * - Placements: one row per placed box with its container, position and size.
 *
 * The report describes the packing on screen, which is the optimizer's once
 * it has finished.
 */

import { summarizeStatus } from './describe'
import { containerTypeName } from './presets'
import { shownResult, type AppState } from './state'
import { fromInt, volumeOf, type Unit } from './units'
import { percent, type Cell, type Sheet, type Workbook } from './xlsx'

export const EXCEL_FILENAME = 'contsim-packing.xlsx'

const UNIT_NAMES: Record<Unit, string> = {
  in: 'inches',
  ft: 'feet',
  cm: 'centimetres',
  mm: 'millimetres',
  m: 'metres',
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local date and time, minute precision: "2026-09-02 14:05". */
export function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Builds the workbook, or null while the inputs are invalid and there is no packing to report. */
export function buildReport(state: AppState, now: Date = new Date()): Workbook | null {
  const { draft, derived } = state
  const { scenario, scale } = derived
  const result = shownResult(state)
  if (!result || !scenario) return null

  const unit = draft.unit
  const length = (int: number) => fromInt(int, scale)
  const volumeUnit = volumeOf(0, scale, unit).unit
  const volume = (int: number) => {
    const v = volumeOf(int, scale, unit)
    return Number(v.value.toFixed(v.decimals + 1))
  }
  const lengthHeader = (label: string) => `${label} (${unit})`
  const volumeHeader = (label: string) => `${label} (${volumeUnit})`

  const status = summarizeStatus(draft, derived, result)
  const { requested, placed, containers: count, containerVolume } = result.stats
  const capacity = containerVolume * Math.max(count, 1)
  const placedByType = new Map<string, number>()
  const placedVolumeByType = new Map<string, number>()
  for (const c of result.containers) {
    for (const p of c.placements) {
      placedByType.set(p.typeId, (placedByType.get(p.typeId) ?? 0) + 1)
      placedVolumeByType.set(p.typeId, (placedVolumeByType.get(p.typeId) ?? 0) + p.dx * p.dy * p.dz)
    }
  }

  const summary: Cell[][] = [
    ['Exported', formatTimestamp(now)],
    ['Status', status.label],
    ['Details', [status.text, ...status.lines].join(' ')],
    ['Unit', unit],
    ['Container type', containerTypeName(draft.containerType)],
    [lengthHeader('Container length'), length(scenario.container.l)],
    [lengthHeader('Container width'), length(scenario.container.w)],
    [lengthHeader('Container height'), length(scenario.container.h)],
    [volumeHeader('Container volume, each'), volume(containerVolume)],
    ['Keep boxes upright', scenario.keepUpright ? 'Yes' : 'No'],
    ['Containers needed', count],
    ['Boxes requested', requested],
    ['Boxes placed', placed],
    ['Boxes left out', requested - placed],
    ['Fill, all containers', percent(result.stats.fill)],
    [volumeHeader('Placed volume'), volume(result.stats.placedVolume)],
    [volumeHeader('Capacity, all containers'), volume(capacity)],
    ['Packing time (ms)', Math.round(result.stats.ms)],
    [
      'Placements sheet',
      `Each box is listed by its back-bottom-left corner, measured from the container's back-bottom-left corner: x along the length, y along the width, z up. Lengths are in ${UNIT_NAMES[unit]}.`,
    ],
  ]

  const containers: Cell[][] = result.containers.map((c, i) => [
    i + 1,
    c.placements.length,
    percent(c.stats.fill),
    volume(c.stats.placedVolume),
  ])

  const boxes: Cell[][] = scenario.types.map((t, i) => {
    const n = placedByType.get(t.id) ?? 0
    const placedVolume = placedVolumeByType.get(t.id) ?? 0
    return [
      i + 1,
      t.name,
      t.color,
      length(t.dims.l),
      length(t.dims.w),
      length(t.dims.h),
      t.qty,
      n,
      t.qty - n,
      volume(t.dims.l * t.dims.w * t.dims.h),
      volume(placedVolume),
      percent(capacity > 0 ? placedVolume / capacity : 0),
    ]
  })

  const names = new Map(scenario.types.map((t) => [t.id, t.name]))
  const placements: Cell[][] = result.containers.flatMap((c, k) =>
    c.placements.map((p, i) => [
      k + 1,
      i + 1,
      names.get(p.typeId) ?? p.typeId,
      length(p.x),
      length(p.y),
      length(p.z),
      length(p.dx),
      length(p.dy),
      length(p.dz),
      length(p.z + p.dz),
    ]),
  )

  const sheets: Sheet[] = [
    { name: 'Summary', header: ['Item', 'Value'], rows: summary, widths: [30, 70] },
    {
      name: 'Containers',
      header: ['Container', 'Boxes', 'Fill', volumeHeader('Placed volume')],
      rows: containers,
      widths: [11, 9, 9, 22],
    },
    {
      name: 'Boxes',
      header: [
        '#',
        'Box',
        'Color',
        lengthHeader('Length'),
        lengthHeader('Width'),
        lengthHeader('Height'),
        'Requested',
        'Placed',
        'Left out',
        volumeHeader('Volume each'),
        volumeHeader('Placed volume'),
        'Share of capacity',
      ],
      rows: boxes,
      widths: [5, 22, 10, 12, 12, 12, 11, 9, 10, 20, 22, 18],
    },
    {
      name: 'Placements',
      header: [
        'Container',
        '#',
        'Box',
        lengthHeader('X'),
        lengthHeader('Y'),
        lengthHeader('Z'),
        lengthHeader('Length'),
        lengthHeader('Width'),
        lengthHeader('Height'),
        lengthHeader('Top'),
      ],
      rows: placements,
      widths: [11, 6, 22, 9, 9, 9, 12, 12, 12, 9],
    },
  ]
  return { sheets }
}
