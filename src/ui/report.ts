/**
 * The Excel report: everything the screen shows about the current scenario
 * and its packing, as a workbook with three sheets.
 *
 * - Summary: status, container, totals, and how to read the other sheets.
 * - Boxes: one row per box type with requested, placed and left-out counts.
 * - Placements: one row per placed box with its position and oriented size.
 *
 * While an Optimize proposal is on screen the report describes that proposal,
 * exactly like the 3D view and the table do.
 */

import { OBJECTIVE_LABELS, summarizeStatus } from './describe'
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
  const { draft, derived, optimize } = state
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

  const proposal = optimize.status === 'done' ? optimize.result : null
  const status = summarizeStatus(draft, derived)
  // While a proposal is shown, the packing's own request is the reduced one; report the user's.
  const requested = scenario.types.reduce((n, t) => n + t.qty, 0)
  const placedByType = new Map<string, number>()
  const placedVolumeByType = new Map<string, number>()
  for (const p of result.placements) {
    placedByType.set(p.typeId, (placedByType.get(p.typeId) ?? 0) + 1)
    placedVolumeByType.set(p.typeId, (placedVolumeByType.get(p.typeId) ?? 0) + p.dx * p.dy * p.dz)
  }

  const summary: Cell[][] = [
    ['Exported', formatTimestamp(now)],
    ['Status', proposal ? 'Optimize proposal' : status.label],
    [
      'Details',
      proposal
        ? `Keeps ${result.stats.placed} of ${requested} boxes with the "${OBJECTIVE_LABELS[optimize.objective]}" objective. Not applied yet; the requested quantities do not fit.`
        : status.text,
    ],
    ['Unit', unit],
    ['Container type', containerTypeName(draft.containerType)],
    [lengthHeader('Container length'), length(scenario.container.l)],
    [lengthHeader('Container width'), length(scenario.container.w)],
    [lengthHeader('Container height'), length(scenario.container.h)],
    [volumeHeader('Container volume'), volume(result.stats.containerVolume)],
    ['Keep boxes upright', scenario.keepUpright ? 'Yes' : 'No'],
    ['Boxes requested', requested],
    ['Boxes placed', result.stats.placed],
    ['Boxes left out', requested - result.stats.placed],
    ['Fill', percent(result.stats.fill)],
    [volumeHeader('Placed volume'), volume(result.stats.placedVolume)],
    ['Packing time (ms)', Math.round(result.stats.ms)],
  ]
  if (proposal) {
    summary.push(
      ['Optimizer runs', proposal.runs],
      ['Optimizer time (ms)', Math.round(proposal.ms)],
    )
  }
  summary.push([
    'Placements sheet',
    `Each box is listed by its back-bottom-left corner, measured from the container's back-bottom-left corner: x along the length, y along the width, z up. Lengths are in ${UNIT_NAMES[unit]}.`,
  ])

  const boxes: Cell[][] = scenario.types.map((t, i) => {
    const placed = placedByType.get(t.id) ?? 0
    const placedVolume = placedVolumeByType.get(t.id) ?? 0
    return [
      i + 1,
      t.name,
      t.color,
      length(t.dims.l),
      length(t.dims.w),
      length(t.dims.h),
      t.qty,
      placed,
      t.qty - placed,
      volume(t.dims.l * t.dims.w * t.dims.h),
      volume(placedVolume),
      percent(result.stats.containerVolume > 0 ? placedVolume / result.stats.containerVolume : 0),
    ]
  })

  const names = new Map(scenario.types.map((t) => [t.id, t.name]))
  const placements: Cell[][] = result.placements.map((p, i) => [
    i + 1,
    names.get(p.typeId) ?? p.typeId,
    length(p.x),
    length(p.y),
    length(p.z),
    length(p.dx),
    length(p.dy),
    length(p.dz),
    length(p.z + p.dz),
  ])

  const sheets: Sheet[] = [
    { name: 'Summary', header: ['Item', 'Value'], rows: summary, widths: [26, 70] },
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
        'Share of container',
      ],
      rows: boxes,
      widths: [5, 22, 10, 12, 12, 12, 11, 9, 10, 20, 22, 19],
    },
    {
      name: 'Placements',
      header: [
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
      widths: [6, 22, 9, 9, 9, 12, 12, 12, 9],
    },
  ]
  return { sheets }
}
