/**
 * Importing from a spreadsheet. Two shapes are understood:
 *
 * - An order: one cabinet or box per row with a code, a quantity, and a size
 *   for boxes that are not in the catalog (the template documents it).
 * - A workbook exported by contsim: its Boxes sheet is read as an order and
 *   its Summary sheet restores the container, unit and upright setting.
 */

import { CATALOG, type CatalogItem } from '../catalog'
import { catalogTexts } from './catalogSearch'
import { nextColor } from './palette'
import { CONTAINER_PRESETS } from './presets'
import type { CellValue, Row, SheetRows } from './spreadsheet'
import { newTypeId, type BoxTypeDraft, type ScenarioImport } from './state'
import { UNITS, type Unit } from './units'
import type { Workbook } from './xlsx'

export const ORDER_TEMPLATE_FILENAME = 'contsim-order-template.xlsx'

/** The format, one rule per line. Shown in the template's Guide sheet and in the README. */
export const ORDER_FORMAT_GUIDE: readonly string[] = [
  'One row per cabinet or box; the first row holds the column headers. Extra columns are ignored and blank rows are skipped.',
  'Code (also accepted: Type, Item, SKU, Name, Box): the catalog code, for example 3036 or DB18(4). Any other text makes a custom box named after it.',
  'Qty (also accepted: Quantity, Count, Pcs, Requested): a whole number.',
  "Width, Depth, Height (also accepted: W, D, H): only needed for boxes that are not in the catalog; ignored for catalog codes. Width runs along the container's length.",
  'Units: put the unit in the header, for example "Width (mm)". Without one, the unit selected in the app applies.',
  'Rows with the same code are added together.',
  'Files: .xlsx (the first sheet is read) or .csv (comma, semicolon or tab separated). A workbook saved with Export Excel is recognized too: its Boxes sheet restores the order and its Summary sheet the container, unit and upright setting.',
]

type Column = 'code' | 'qty' | 'first' | 'second' | 'third' | 'color'

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
  second: ['d', 'depth'],
  third: ['h', 'height'],
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

const MM: Record<Unit, number> = { in: 25.4, ft: 304.8, cm: 10, mm: 1, m: 1000 }

export function convertLength(value: number, from: Unit, to: Unit): number {
  return from === to ? value : Number(((value * MM[from]) / MM[to]).toFixed(3))
}

export interface Header {
  column: Column
  /** The header word that matched, e.g. "length". */
  word: string
  unit: Unit | null
}

/** "Width (mm)" -> first size in mm; "QTY" -> qty; anything unknown -> null. */
export function parseHeader(cell: CellValue | undefined): Header | null {
  if (cell === undefined) return null
  let text = String(cell).toLowerCase().trim()
  let unit: Unit | null = null
  const inParens = /\(([^)]*)\)/.exec(text)
  const unitText =
    inParens?.[1]?.trim() ?? /\b(in|inch|inches|ft|feet|foot|cm|mm|m)$/.exec(text)?.[1]
  if (unitText && UNIT_WORDS[unitText]) {
    unit = UNIT_WORDS[unitText]!
    text = text.replace(inParens?.[0] ?? unitText, '')
  }
  const word = text.replace(/[^a-z]/g, '')
  for (const column of Object.keys(HEADERS) as Column[]) {
    if (HEADERS[column].includes(word)) return { column, word, unit }
  }
  return null
}

const normalizeCode = (code: string) => code.toUpperCase().replace(/\s+/g, '')
const byCode = new Map(CATALOG.map((item) => [normalizeCode(item.code), item]))

const cellText = (cell: CellValue | undefined): string =>
  cell === undefined ? '' : String(cell).trim()

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
  /** Rows skipped or merged, in plain language. */
  notes: string[]
}

export type ImportParse = { ok: true; imported: Imported } | { ok: false; error: string }

const MAX_HEADER_SCAN = 20

interface Found {
  index: number
  word: string
  unit: Unit | null
}

/**
 * Turns the rows of an order sheet into box rows. `unit` is the app's current
 * unit, used for sizes whose header names none; `existing` supplies the ids
 * to avoid.
 */
export function importOrder(
  rows: Row[],
  unit: Unit,
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
        const widthSecond = lengthFirst === h ? found.first : { index, word: h.word, unit: h.unit }
        found.first = {
          index: lengthFirst === h ? index : found.first.index,
          word: lengthFirst.word,
          unit: lengthFirst.unit,
        }
        found.second ??= widthSecond
        return
      }
      if (!found[h.column]) found[h.column] = { index, word: h.word, unit: h.unit }
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
      notes.push(`Row ${line}: no code, skipped`)
      continue
    }
    const qty = parseQuantity(row[columns.qty!.index])
    if (qty === null) {
      const shown = cellText(row[columns.qty!.index]) || 'blank'
      notes.push(`Row ${line} (${code}): quantity "${shown}" is not a whole number, skipped`)
      continue
    }
    const colorText = columns.color ? cellText(row[columns.color.index]) : ''
    const color = /^#[0-9a-f]{6}$/i.test(colorText) ? colorText.toLowerCase() : null

    const item: CatalogItem | undefined = byCode.get(normalizeCode(code))
    if (item) {
      add(
        `catalog:${item.code}`,
        { kind: 'catalog', catalogCode: item.code, name: item.code, ...catalogTexts(item, unit) },
        qty,
        color,
        item.code,
      )
      continue
    }

    const size = sizeColumns.map((column) => {
      if (!column) return null
      const value = parseLength(row[column.index])
      return value === null || value <= 0 ? null : convertLength(value, column.unit ?? unit, unit)
    })
    if (size.every((v): v is number => v !== null)) {
      const [l, w, h] = size.map(String) as [string, string, string]
      add(
        `custom:${code}|${l}|${w}|${h}`,
        { kind: 'custom', catalogCode: '', name: code, l, w, h },
        qty,
        color,
        `"${code}"`,
      )
    } else {
      notes.push(`Row ${line}: "${code}" is not in the catalog and has no complete size, skipped`)
    }
  }

  const types = [...merged.values()]
  if (types.length === 0) {
    return { ok: false, error: `No usable rows. ${notes[0] ?? ''}`.trim() }
  }
  const boxes = types.reduce((n, t) => n + Number(t.qty), 0)
  return { ok: true, imported: { types, boxes, notes, container: null } }
}

/** The container settings written by the Excel export's Summary sheet, if they are all there. */
export function readSummary(rows: Row[], fallbackUnit: Unit): ImportedContainer | null {
  const values = new Map<string, CellValue | undefined>()
  for (const row of rows) {
    const key = cellText(row[0]).toLowerCase()
    if (key) values.set(key, row[1])
  }
  const unitText = cellText(values.get('unit'))
  const unit = UNITS.includes(unitText as Unit) ? (unitText as Unit) : fallbackUnit
  const typeName = cellText(values.get('container type')).toLowerCase()
  if (!typeName) return null
  const preset = CONTAINER_PRESETS.find((p) => p.name.toLowerCase() === typeName)
  const keepUpright = cellText(values.get('keep boxes upright')).toLowerCase() === 'yes'
  if (preset) return { containerType: preset.id, container: null, unit, keepUpright }

  const dims = ['length', 'width', 'height'].map((side) => {
    const entry = [...values.entries()].find(([k]) => k.startsWith(`container ${side}`))
    const value = entry ? parseLength(entry[1]) : null
    return value !== null && value > 0 ? String(value) : null
  })
  if (!dims.every((d): d is string => d !== null)) return null
  return {
    containerType: 'custom',
    container: { l: dims[0], w: dims[1], h: dims[2] },
    unit,
    keepUpright,
  }
}

/**
 * A workbook: a contsim export (Boxes + Summary sheets) or a plain order in
 * the first sheet.
 */
export function importWorkbook(
  sheets: SheetRows[],
  unit: Unit,
  existing: readonly BoxTypeDraft[],
): ImportParse {
  const byName = (name: string) => sheets.find((s) => s.name.trim().toLowerCase() === name)
  const boxes = byName('boxes')
  const summary = byName('summary')
  if (boxes && summary) {
    const container = readSummary(summary.rows, unit)
    const parsed = importOrder(boxes.rows, container?.unit ?? unit, existing)
    if (!parsed.ok) return parsed
    return { ok: true, imported: { ...parsed.imported, container } }
  }
  return importOrder(sheets[0]!.rows, unit, existing)
}

/** The template workbook: an Order sheet with examples and a Guide sheet with the rules. */
export function orderTemplate(unit: Unit): Workbook {
  const size = (inches: number) => convertLength(inches, 'in', unit)
  return {
    sheets: [
      {
        name: 'Order',
        header: ['Code', 'Qty', `Width (${unit})`, `Depth (${unit})`, `Height (${unit})`, 'Note'],
        rows: [
          ['3036', 4, null, null, null, 'A catalog code: the size comes from the catalog'],
          ['DB18(4)', 2, null, null, null, ''],
          ['Crate', 1, size(40), size(30), size(20), 'Not in the catalog: give the size'],
        ],
        widths: [14, 8, 12, 12, 12, 50],
      },
      {
        name: 'Guide',
        header: ['#', 'How to fill in the Order sheet'],
        rows: ORDER_FORMAT_GUIDE.map((line, i) => [i + 1, line]),
        widths: [4, 120],
      },
    ],
  }
}
