/**
 * Minimal .xlsx writer (ECMA-376 SpreadsheetML): a workbook of sheets of
 * strings, numbers, booleans, percentages and coloured blocks, with an
 * optional bold header row. Strings are written inline, so no shared-string
 * table is needed. The format subset used here has been stable since 2006 and
 * is read by Excel, LibreOffice, Numbers and Google Sheets.
 */

import { zip, type Bytes, type ZipEntry, type ZipOptions } from './zip'

/** A fraction in [0, 1] shown with one decimal, e.g. 0.882 -> 88.2%. */
export interface Percent {
  percent: number
}

/** A cell painted a solid colour: the pixels a drawing is made of. */
export interface Block {
  /** "#rrggbb". */
  fill: string
  value?: string | number
}

export type Cell = string | number | boolean | Percent | Block | null | undefined

export const block = (fill: string, value?: string | number): Block => ({ fill, value })

export interface Sheet {
  name: string
  /** Bold and frozen. Omit for a sheet that is not a table. */
  header?: string[]
  rows: Cell[][]
  /** Column widths in characters, by column index. Missing entries use `width`. */
  widths?: number[]
  /** Width for every column the list above does not name. */
  width?: number
  /** Row heights in points, by row index counting any header. */
  heights?: Record<number, number>
}

export interface Workbook {
  sheets: Sheet[]
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const percent = (value: number): Percent => ({ percent: value })

// Indexes into cellXfs in styles.xml below; colours follow after these.
const STYLE_HEADER = 1
const STYLE_PERCENT = 2
const STYLE_COUNT = 3

const isBlock = (cell: Cell): cell is Block =>
  typeof cell === 'object' && cell !== null && 'fill' in cell

/** "#f59e0b" as Excel's "FFF59E0B"; anything unreadable comes out white. */
function argb(fill: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(fill.trim())
  return `FF${(hex?.[1] ?? 'ffffff').toUpperCase()}`
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'

// Characters XML 1.0 cannot carry at all; Excel refuses files that contain them.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Spreadsheet column label for a zero-based index: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLabel(index: number): string {
  let label = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label
  }
  return label
}

const SHEET_NAME_MAX = 31

/** A legal, unique sheet name: Excel forbids some characters, limits length, and requires uniqueness. */
export function sheetName(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim() || 'Sheet'
  let candidate = base.slice(0, SHEET_NAME_MAX)
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`
    candidate = base.slice(0, SHEET_NAME_MAX - suffix.length) + suffix
  }
  return candidate
}

function cellXml(ref: string, cell: Cell, style = 0, fills?: Map<string, number>): string {
  if (isBlock(cell)) {
    const painted = fills?.get(argb(cell.fill)) ?? 0
    const value = cell.value
    if (value === undefined) return `<c r="${ref}" s="${painted}"/>`
    return typeof value === 'number'
      ? `<c r="${ref}" s="${painted}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr" s="${painted}"><is><t>${escapeXml(value)}</t></is></c>`
  }
  const s = style ? ` s="${style}"` : ''
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'string') {
    const space = /^\s|\s$|\n/.test(cell) ? ' xml:space="preserve"' : ''
    return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${escapeXml(cell)}</t></is></c>`
  }
  if (typeof cell === 'boolean') return `<c r="${ref}" t="b"${s}><v>${cell ? 1 : 0}</v></c>`
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? `<c r="${ref}"${s}><v>${cell}</v></c>` : ''
  }
  return Number.isFinite(cell.percent)
    ? `<c r="${ref}" s="${STYLE_PERCENT}"><v>${cell.percent}</v></c>`
    : ''
}

function rowXml(
  index: number,
  cells: Cell[],
  style = 0,
  fills?: Map<string, number>,
  height?: number,
): string {
  const body = cells
    .map((cell, i) => cellXml(`${columnLabel(i)}${index}`, cell, style, fills))
    .join('')
  const ht = height === undefined ? '' : ` ht="${height}" customHeight="1"`
  return `<row r="${index}"${ht}>${body}</row>`
}

export function sheetXml(sheet: Sheet, selected: boolean, fills?: Map<string, number>): string {
  const columns = Math.max(sheet.header?.length ?? 0, ...sheet.rows.map((r) => r.length), 1)
  const heights = sheet.heights ?? {}
  const rows: string[] = []
  let at = 0
  if (sheet.header) rows.push(rowXml(++at, sheet.header, STYLE_HEADER, fills, heights[0]))
  for (const cells of sheet.rows) {
    const index = at++
    rows.push(rowXml(at, cells, 0, fills, heights[index]))
  }
  const named = (sheet.widths ?? [])
    .map((width, i) =>
      width ? `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>` : '',
    )
    .join('')
  const rest =
    sheet.width === undefined
      ? ''
      : `<col min="${(sheet.widths?.length ?? 0) + 1}" max="16384" width="${sheet.width}" customWidth="1"/>`
  const cols = named + rest
  return (
    XML_HEADER +
    `<worksheet xmlns="${NS_MAIN}">` +
    `<dimension ref="A1:${columnLabel(columns - 1)}${Math.max(rows.length, 1)}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>` +
    (sheet.header
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
      : '') +
    '</sheetView></sheetViews>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>'
  )
}

/** One fill and one format per colour, after the three the tables use. */
function stylesXml(colours: readonly string[]): string {
  const fills = colours
    .map(
      (rgb) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`,
    )
    .join('')
  const painted = colours
    .map(
      (_, i) =>
        `<xf numFmtId="0" fontId="0" fillId="${i + 2}" borderId="0" xfId="0" applyFill="1"/>`,
    )
    .join('')
  return (
    XML_HEADER +
    `<styleSheet xmlns="${NS_MAIN}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    `<fills count="${colours.length + 2}">` +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    fills +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${STYLE_COUNT + colours.length}">` +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    painted +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  )
}

/** Every colour the workbook paints with, as Excel ARGB, in the order it meets them. */
export function paintedColours(workbook: Workbook): string[] {
  const seen: string[] = []
  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (!isBlock(cell)) continue
        const rgb = argb(cell.fill)
        if (!seen.includes(rgb)) seen.push(rgb)
      }
    }
  }
  return seen
}

/** The parts of the package, ready to be zipped. Pure and synchronous, so easy to test. */
export function workbookParts(workbook: Workbook): ZipEntry[] {
  const colours = paintedColours(workbook)
  const fills = new Map(colours.map((rgb, i) => [rgb, STYLE_COUNT + i]))
  const taken = new Set<string>()
  const names = workbook.sheets.map((sheet) => {
    const name = sheetName(sheet.name, taken)
    taken.add(name.toLowerCase())
    return name
  })
  const sheetFile = (i: number) => `worksheets/sheet${i + 1}.xml`

  const contentTypes =
    XML_HEADER +
    `<Types xmlns="${NS_CONTENT_TYPES}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    workbook.sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/${sheetFile(i)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '</Types>'

  const rootRels =
    XML_HEADER +
    `<Relationships xmlns="${NS_PACKAGE_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'

  const workbookXml =
    XML_HEADER +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<sheets>' +
    names
      .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets>' +
    '</workbook>'

  const workbookRels =
    XML_HEADER +
    `<Relationships xmlns="${NS_PACKAGE_REL}">` +
    names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="${sheetFile(i)}"/>`,
      )
      .join('') +
    `<Relationship Id="rId${names.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>'

  return [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: stylesXml(colours) },
    ...workbook.sheets.map((sheet, i) => ({
      name: `xl/${sheetFile(i)}`,
      data: sheetXml(sheet, i === 0, fills),
    })),
  ]
}

export function writeXlsx(workbook: Workbook, options?: ZipOptions): Promise<Bytes> {
  if (workbook.sheets.length === 0) throw new Error('A workbook needs at least one sheet')
  return zip(workbookParts(workbook), options)
}
