/**
 * Importing from a spreadsheet. Two shapes are understood:
 *
 * - An order: one cabinet or box per row with a code, a quantity, and a size
 *   for boxes that are not in the catalog (the template documents it).
 * - A workbook exported by contsim: its Boxes sheet is read as an order and
 *   its Summary sheet restores the container, unit and upright setting.
 */

import type { CatalogItem } from '../catalog'
import type { LoadMode } from '../core'
import { catalogTexts } from './catalogSearch'
import { findCatalogItem } from './catalogStore'
import { nextColor } from './palette'
import { CONTAINER_PRESETS } from './presets'
import type { CellValue, Row, SheetRows } from './spreadsheet'
import { newTypeId, type BoxTypeDraft, type ScenarioImport } from './state'
import { UNITS, convertLength, convertWeight, type Unit, type WeightUnit } from './units'

type Column =
  'code' | 'qty' | 'first' | 'second' | 'third' | 'size' | 'weight' | 'fragile' | 'color'

/** Header words per column. "length" and "width" both mean the first size unless both appear (see importOrder). */
const HEADERS: Record<Column, readonly string[]> = {
  code: [
    'code',
    'type',
    'item',
    'sku',
    'cabinet',
    'model',
    'part',
    'partnumber',
    'name',
    'description',
    'box',
    'product',
  ],
  qty: ['qty', 'quantity', 'count', 'pcs', 'pieces', 'units', 'amount', 'q', 'requested'],
  first: ['w', 'width', 'l', 'length'],
  size: ['size', 'dimensions', 'dims'],
  second: ['d', 'depth'],
  third: ['h', 'height'],
  weight: ['weight', 'wt', 'mass', 'weighteach', 'weightper', 'weightperbox', 'unitweight'],
  fragile: ['fragile', 'delicate'],
  color: ['color', 'colour'],
}

const UNIT_WORDS: Record<string, Unit> = {
  in: 'in',
  inch: 'in',
  inches: 'in',
  ft: 'ft',
  feet: 'ft',
  foot: 'ft',
  cm: 'cm',
  mm: 'mm',
  m: 'm',
}

const WEIGHT_UNIT_WORDS: Record<string, WeightUnit> = {
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
}

export interface Header {
  column: Column
  /** The header word that matched, e.g. "length". */
  word: string
  unit: Unit | null
  weightUnit: WeightUnit | null
}

/** "Width (mm)" -> first size in mm; "QTY" -> qty; anything unknown -> null. */
export function parseHeader(cell: CellValue | undefined): Header | null {
  if (cell === undefined) return null
  let text = String(cell).toLowerCase().trim()
  let unit: Unit | null = null
  let weightUnit: WeightUnit | null = null
  const inParens = /\(([^)]*)\)/.exec(text)
  const unitText =
    inParens?.[1]?.trim() ??
    /\b(in|inch|inches|ft|feet|foot|cm|mm|m|kg|kgs|lb|lbs|pound|pounds)$/.exec(text)?.[1]
  if (unitText && (UNIT_WORDS[unitText] ?? WEIGHT_UNIT_WORDS[unitText])) {
    unit = UNIT_WORDS[unitText] ?? null
    weightUnit = WEIGHT_UNIT_WORDS[unitText] ?? null
    text = text.replace(inParens?.[0] ?? unitText, '')
  }
  const word = text.replace(/[^a-z]/g, '')
  for (const column of Object.keys(HEADERS) as Column[]) {
    if (HEADERS[column].includes(word)) return { column, word, unit, weightUnit }
  }
  return null
}

const cellText = (cell: CellValue | undefined): string =>
  cell === undefined ? '' : String(cell).trim()

/** "30 × 12 × 36" as three numbers, or null when the cell is not a size. */
/**
 * A custom container's size: the "Container size" cell of a workbook this app
 * wrote, or the three separate rows an older one has.
 */
function containerDims(
  values: Map<string, CellValue | undefined>,
): [string, string, string] | null {
  const sizeKey = [...values.keys()].find((k) => k.startsWith('container size'))
  const size = sizeKey ? splitSize(values.get(sizeKey)) : null
  if (size) return size.map(String) as [string, string, string]

  const dims = ['length', 'width', 'height'].map((side) => {
    const entry = [...values.entries()].find(([k]) => k.startsWith(`container ${side}`))
    const value = entry ? parseLength(entry[1]) : null
    return value !== null && value > 0 ? String(value) : null
  })
  return dims.every((d): d is string => d !== null) ? (dims as [string, string, string]) : null
}

function splitSize(cell: CellValue | undefined): [number, number, number] | null {
  const parts = cellText(cell)
    .split(/[×x*]/i)
    .map((part) => Number(part.trim().replace(',', '.')))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null
  return parts as [number, number, number]
}

/** A whole number, from a number or a numeric string. */
function parseQuantity(cell: CellValue | undefined): number | null {
  if (typeof cell === 'number') return Number.isInteger(cell) && cell >= 0 ? cell : null
  const text = cellText(cell)
  return /^\d+$/.test(text) ? Number(text) : null
}

/** A length such as 34.5, "34,5", "34 1/2" or '36"'; null when it is not one. */
function parseLength(cell: CellValue | undefined): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  const m = /^\s*(\d+(?:[.,]\d+)?)(?:\s+(\d+)\/(\d+))?\s*(?:[a-z"']+)?\s*$/i.exec(cellText(cell))
  if (!m) return null
  const whole = Number(m[1]!.replace(',', '.'))
  const fraction = m[2] && m[3] && Number(m[3]) > 0 ? Number(m[2]) / Number(m[3]) : 0
  return whole + fraction
}

export type ImportedContainer = NonNullable<ScenarioImport['container']>

export interface Imported extends ScenarioImport {
  /** Boxes in total. */
  boxes: number
  /** Rows that were left out. */
  skipped: number
  /** Rows skipped or merged, in plain language. */
  notes: string[]
  /** The unit named by a size column header, when there was one. */
  detectedUnit: Unit | null
  /** The unit named by the weight column header, when there was one. */
  detectedWeightUnit: WeightUnit | null
  /** Whether any row brought a weight, so the app knows whether to ask about it. */
  hasWeights: boolean
}

export type ImportParse = { ok: true; imported: Imported } | { ok: false; error: string }

const MAX_HEADER_SCAN = 20

interface Found {
  index: number
  word: string
  unit: Unit | null
  weightUnit: WeightUnit | null
}

/**
 * Turns the rows of an order sheet into box rows. `unit` is the app's current
 * unit, used for sizes whose header names none; `existing` supplies the ids
 * to avoid.
 */
export function importOrder(
  rows: Row[],
  unit: Unit,
  weightUnit: WeightUnit,
  existing: readonly BoxTypeDraft[],
): ImportParse {
  let headerRow = -1
  let columns: Partial<Record<Column, Found>> = {}
  for (let r = 0; r < Math.min(rows.length, MAX_HEADER_SCAN); r++) {
    const found: Partial<Record<Column, Found>> = {}
    rows[r]!.forEach((cell, index) => {
      const h = parseHeader(cell)
      if (!h) return
      // Length and Width side by side is the app's own naming: length first, width second.
      if (h.column === 'first' && found.first && found.first.word !== h.word) {
        const lengthFirst = ['l', 'length'].includes(h.word) ? h : found.first
        const widthSecond =
          lengthFirst === h ? found.first : { index, word: h.word, unit: h.unit, weightUnit: null }
        found.first = {
          index: lengthFirst === h ? index : found.first.index,
          word: lengthFirst.word,
          unit: lengthFirst.unit,
          weightUnit: null,
        }
        found.second ??= widthSecond
        return
      }
      if (!found[h.column]) {
        found[h.column] = { index, word: h.word, unit: h.unit, weightUnit: h.weightUnit }
      }
    })
    if (found.code && found.qty) {
      headerRow = r
      columns = found
      break
    }
  }
  if (headerRow < 0) {
    return {
      ok: false,
      error:
        'No header row with a code and a quantity column was found. Expected columns: Code, Qty, and for custom sizes Width, Depth, Height. Download the order template for an example.',
    }
  }

  const notes: string[] = []
  let skipped = 0
  const merged = new Map<string, BoxTypeDraft>()
  const ids = existing.map((t) => t.id)
  const usedColors: string[] = []

  const add = (
    key: string,
    type: Omit<BoxTypeDraft, 'id' | 'color' | 'qty'>,
    qty: number,
    color: string | null,
    label: string,
  ) => {
    const present = merged.get(key)
    if (present) {
      present.qty = String(Number(present.qty) + qty)
      if (!notes.some((n) => n.startsWith(`${label} appears`))) {
        notes.push(`${label} appears more than once; quantities added`)
      }
      return
    }
    const id = newTypeId(ids)
    ids.push(id)
    const chosen = color && !usedColors.includes(color) ? color : nextColor(usedColors)
    usedColors.push(chosen)
    merged.set(key, { ...type, id, color: chosen, qty: String(qty) })
  }

  const sizeColumns = [columns.first, columns.second, columns.third]
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!
    const line = r + 1
    if (row.every((cell) => cellText(cell) === '')) continue
    const code = cellText(row[columns.code!.index])
    if (!code) {
      skipped++
      notes.push(`Row ${line}: no code, skipped`)
      continue
    }
    const qty = parseQuantity(row[columns.qty!.index])
    if (qty === null) {
      const shown = cellText(row[columns.qty!.index]) || 'blank'
      skipped++
      notes.push(`Row ${line} (${code}): quantity "${shown}" is not a whole number, skipped`)
      continue
    }
    const colorText = columns.color ? cellText(row[columns.color.index]) : ''
    const color = /^#[0-9a-f]{6}$/i.test(colorText) ? colorText.toLowerCase() : null
    // A header naming its own unit wins; otherwise the weight is in the app's.
    const weightColumn = columns.weight
    const weighs = weightColumn ? parseLength(row[weightColumn.index]) : null
    const weightText =
      weighs === null || weighs <= 0
        ? ''
        : String(convertWeight(weighs, weightColumn?.weightUnit ?? weightUnit, weightUnit))
    // Anything but a plain no counts as fragile: "yes", "y", "true", "x", "1".
    const fragileText = columns.fragile ? cellText(row[columns.fragile.index]).toLowerCase() : ''
    const fragile = fragileText !== '' && !['no', 'n', 'false', '0', '-'].includes(fragileText)

    const item: CatalogItem | null = findCatalogItem(code)
    if (item) {
      add(
        `catalog:${item.code}`,
        {
          kind: 'catalog',
          catalogCode: item.code,
          name: item.code,
          ...catalogTexts(item, unit),
          weight: weightText,
          fragile,
        },
        qty,
        color,
        item.code,
      )
      continue
    }

    // Either three columns, or one "L × W × H" cell as the export writes it.
    const combined = columns.size ? splitSize(row[columns.size.index]) : null
    const size = sizeColumns.map((column, i) => {
      const value = column ? parseLength(row[column.index]) : (combined?.[i] ?? null)
      if (value === null || value <= 0) return null
      return convertLength(value, column?.unit ?? columns.size?.unit ?? unit, unit)
    })
    if (size.every((v): v is number => v !== null)) {
      const [l, w, h] = size.map(String) as [string, string, string]
      add(
        `custom:${code}|${l}|${w}|${h}`,
        { kind: 'custom', catalogCode: '', name: code, l, w, h, weight: weightText, fragile },
        qty,
        color,
        `"${code}"`,
      )
    } else {
      skipped++
      notes.push(`Row ${line}: "${code}" is not in the catalog and has no complete size, skipped`)
    }
  }

  const types = [...merged.values()]
  if (types.length === 0) {
    return { ok: false, error: `No usable rows. ${notes[0] ?? ''}`.trim() }
  }
  const boxes = types.reduce((n, t) => n + Number(t.qty), 0)
  const detectedUnit = sizeColumns.find((c) => c?.unit)?.unit ?? null
  return {
    ok: true,
    imported: {
      types,
      boxes,
      skipped,
      notes,
      unit,
      weightUnit,
      detectedUnit,
      detectedWeightUnit: columns.weight?.weightUnit ?? null,
      hasWeights: types.some((t) => t.weight !== ''),
      container: null,
    },
  }
}

export interface Summary {
  container: ImportedContainer
  unit: Unit
  weightUnit: WeightUnit
}

/** The container settings written by the Excel export's Summary sheet, if they are all there. */
export function readSummary(
  rows: Row[],
  fallbackUnit: Unit,
  fallbackWeightUnit: WeightUnit,
): Summary | null {
  const values = new Map<string, CellValue | undefined>()
  for (const row of rows) {
    const key = cellText(row[0]).toLowerCase()
    if (key) values.set(key, row[1])
  }
  const unitText = cellText(values.get('unit'))
  const unit = UNITS.includes(unitText as Unit) ? (unitText as Unit) : fallbackUnit
  const weightText = cellText(values.get('weight unit')).toLowerCase()
  const weightUnit = weightText === 'kg' || weightText === 'lb' ? weightText : fallbackWeightUnit
  const payload = parseLength(values.get('payload per container'))
  const maxWeight = payload !== null && payload > 0 ? String(payload) : ''
  const typeName = cellText(values.get('container type')).toLowerCase()
  if (!typeName) return null
  const preset = CONTAINER_PRESETS.find((p) => p.name.toLowerCase() === typeName)
  // Written since 2026-09-09; an older workbook gets the app's default.
  const mode: LoadMode =
    cellText(values.get('loading mode')).toLowerCase() === 'optimize' ? 'optimize' : 'even'
  if (preset) {
    return {
      container: { containerType: preset.id, container: null, maxWeight, mode },
      unit,
      weightUnit,
    }
  }

  const dims = containerDims(values)
  if (!dims) return null
  return {
    container: {
      containerType: 'custom',
      container: { l: dims[0], w: dims[1], h: dims[2] },
      maxWeight,
      mode,
    },
    unit,
    weightUnit,
  }
}

/**
 * A workbook: a contsim export (Boxes + Summary sheets) or a plain order in
 * the first sheet.
 */
export function importWorkbook(
  sheets: SheetRows[],
  unit: Unit,
  weightUnit: WeightUnit,
  existing: readonly BoxTypeDraft[],
): ImportParse {
  // A workbook contsim wrote: one sheet per container, each opening with the
  // settings and carrying its own share of the boxes, so the counts add up.
  const perContainer = sheets.filter((s) => /^container\s+\d+$/i.test(s.name.trim()))
  if (perContainer.length > 0) {
    const read = readSummary(perContainer[0]!.rows, unit, weightUnit)
    const rows = joinContainerSheets(perContainer)
    if (rows.length > 1) {
      const parsed = importOrder(rows, read?.unit ?? unit, read?.weightUnit ?? weightUnit, existing)
      if (!parsed.ok) return parsed
      return { ok: true, imported: { ...parsed.imported, container: read?.container ?? null } }
    }
  }
  return importOrder(sheets[0]!.rows, unit, weightUnit, existing)
}

/**
 * The box tables of every container sheet as one order. The same box is on
 * every sheet that carries one, so the counts are added up here rather than
 * left to look like a mistake in the file.
 */
function joinContainerSheets(sheets: SheetRows[]): Row[] {
  let header: Row | null = null
  let codeAt = -1
  let qtyAt = -1
  const byCode = new Map<string, Row>()
  for (const sheet of sheets) {
    const table = boxTableOf(sheet.rows)
    if (table.length === 0) continue
    if (!header) {
      header = table[0]!
      header.forEach((cell, i) => {
        const column = parseHeader(cell)?.column
        if (column === 'code' && codeAt < 0) codeAt = i
        if (column === 'qty' && qtyAt < 0) qtyAt = i
      })
    }
    for (const row of table.slice(1)) {
      const code = cellText(row[codeAt]).toUpperCase()
      const seen = byCode.get(code)
      if (!seen) {
        byCode.set(code, [...row])
        continue
      }
      seen[qtyAt] = (Number(seen[qtyAt]) || 0) + (Number(row[qtyAt]) || 0)
    }
  }
  return header ? [header, ...byCode.values()] : []
}

/** The box table on a container sheet: its header row, then rows until a blank one. */
function boxTableOf(rows: Row[]): Row[] {
  const start = rows.findIndex((row) => {
    const found = new Set(row.map((cell) => parseHeader(cell)?.column))
    return found.has('code') && found.has('qty')
  })
  if (start < 0) return []
  const table = [rows[start]!]
  for (let r = start + 1; r < rows.length; r++) {
    const row = rows[r]!
    if (row.every((cell) => cellText(cell) === '')) break
    table.push(row)
  }
  return table
}
