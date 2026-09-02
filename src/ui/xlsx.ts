/**
 * Minimal .xlsx writer (ECMA-376 SpreadsheetML): a workbook of sheets, each a
 * bold header row followed by rows of strings, numbers, booleans or
 * percentages. Strings are written inline, so no shared-string table is
 * needed. The format subset used here has been stable since 2006 and is read
 * by Excel, LibreOffice, Numbers and Google Sheets.
 */

import { zip, type Bytes, type ZipEntry, type ZipOptions } from './zip'

/** A fraction in [0, 1] shown with one decimal, e.g. 0.882 -> 88.2%. */
export interface Percent {
  percent: number
}

export type Cell = string | number | boolean | Percent | null | undefined

export interface Sheet {
  name: string
  header: string[]
  rows: Cell[][]
  /** Column widths in characters, by column index. Missing entries use the default. */
  widths?: number[]
}

export interface Workbook {
  sheets: Sheet[]
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const percent = (value: number): Percent => ({ percent: value })

// Indexes into cellXfs in styles.xml below.
const STYLE_HEADER = 1
const STYLE_PERCENT = 2

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

function cellXml(ref: string, cell: Cell, style = 0): string {
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

function rowXml(index: number, cells: Cell[], style = 0): string {
  const body = cells.map((cell, i) => cellXml(`${columnLabel(i)}${index}`, cell, style)).join('')
  return `<row r="${index}">${body}</row>`
}

export function sheetXml(sheet: Sheet, selected: boolean): string {
  const columns = Math.max(sheet.header.length, ...sheet.rows.map((r) => r.length), 1)
  const rows = [rowXml(1, sheet.header, STYLE_HEADER)]
  sheet.rows.forEach((cells, i) => rows.push(rowXml(i + 2, cells)))
  const cols = (sheet.widths ?? [])
    .map((width, i) =>
      width ? `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>` : '',
    )
    .join('')
  return (
    XML_HEADER +
    `<worksheet xmlns="${NS_MAIN}">` +
    `<dimension ref="A1:${columnLabel(columns - 1)}${rows.length}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>'
  )
}

const STYLES_XML =
  XML_HEADER +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="2">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/** The parts of the package, ready to be zipped. Pure and synchronous, so easy to test. */
export function workbookParts(workbook: Workbook): ZipEntry[] {
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
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...workbook.sheets.map((sheet, i) => ({
      name: `xl/${sheetFile(i)}`,
      data: sheetXml(sheet, i === 0),
    })),
  ]
}

export function writeXlsx(workbook: Workbook, options?: ZipOptions): Promise<Bytes> {
  if (workbook.sheets.length === 0) throw new Error('A workbook needs at least one sheet')
  return zip(workbookParts(workbook), options)
}
