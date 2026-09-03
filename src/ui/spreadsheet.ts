/**
 * Reading spreadsheets: the first sheet of an .xlsx (a ZIP of XML parts) or
 * a .csv file, as rows of cell values. Runs in the browser (the order import)
 * and in Node (scripts/import-catalog.ts); both provide DecompressionStream.
 */

import { crc32, type Bytes } from './zip'

export type CellValue = string | number | boolean
/** Cells Excel left out are holes; a row that only holds holes is an empty row. */
export type Row = CellValue[]

const decoder = new TextDecoder()

async function inflateRaw(data: Bytes): Promise<Bytes> {
  const stream = new DecompressionStream('deflate-raw')
  const output = new Response(stream.readable).arrayBuffer()
  const writer = stream.writable.getWriter()
  await writer.write(data)
  await writer.close()
  return new Uint8Array(await output)
}

/** The entries of a ZIP archive by name. Rejects anything that is not one, or is damaged. */
export async function unzip(bytes: Bytes): Promise<Map<string, Bytes>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive')
  const count = view.getUint16(eocd + 10, true)
  const directoryOffset = view.getUint32(eocd + 16, true)

  const entries = new Map<string, Bytes>()
  let p = directoryOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) {
      throw new Error('Damaged ZIP archive')
    }
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const compressedSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLength = view.getUint16(p + 28, true)
    const extraLength = view.getUint16(p + 30, true)
    const commentLength = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength))
    p += 46 + nameLength + extraLength + commentLength

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error('Damaged ZIP archive')
    }
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true)
    const raw = bytes.subarray(start, start + compressedSize)
    let data: Bytes
    if (method === 8) data = await inflateRaw(raw)
    else if (method === 0) data = raw
    else throw new Error(`Unsupported ZIP compression (method ${method})`)
    if (data.length !== size || crc32(data) !== crc) throw new Error(`Damaged ZIP entry ${name}`)
    entries.set(name, data)
  }
  return entries
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? decodeXml(m[1]!) : null
}

/** Shared strings in order; rich text runs are joined. */
function sharedStrings(xml: string | null): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map((si) =>
    [...si[1]!.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => decodeXml(t[1]!)).join(''),
  )
}

function columnIndex(label: string): number {
  let n = 0
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Rows of a worksheet part, indexed as in Excel (row 7 is rows[6]); empty rows are []. */
export function parseSheet(xml: string, shared: string[]): Row[] {
  const rows: Row[] = []
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>(.*?)<\/row>)/gs)) {
    const r = Number(attr(row[0]!.slice(0, row[0]!.indexOf('>') + 1), 'r'))
    const cells: Row = []
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const [, attrs, inner = ''] = cell
      const ref = attr(`<c${attrs}`, 'r')
      const column = ref ? columnIndex(ref.replace(/\d+$/, '')) : cells.length
      const type = attr(`<c${attrs}`, 't')
      const v = /<v>(.*?)<\/v>/s.exec(inner)?.[1]
      if (type === 's') cells[column] = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') {
        cells[column] = [...inner.matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
          .map((t) => decodeXml(t[1]!))
          .join('')
      } else if (type === 'str') cells[column] = decodeXml(v ?? '')
      else if (type === 'b') cells[column] = v === '1'
      else if (type === 'e') continue
      else if (v !== undefined) cells[column] = Number(v)
    }
    if (Number.isFinite(r) && r >= 1) rows[r - 1] = cells
    else rows.push(cells)
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= []
  return rows
}

export interface SheetRows {
  name: string
  rows: Row[]
}

/** Every worksheet of an .xlsx workbook, in workbook order. */
export async function readWorkbook(bytes: Bytes): Promise<SheetRows[]> {
  let parts: Map<string, Bytes>
  try {
    parts = await unzip(bytes)
  } catch {
    throw new Error('Not an Excel workbook (.xlsx)')
  }
  const text = (name: string) => {
    const part = parts.get(name)
    return part ? decoder.decode(part) : null
  }
  const workbook = text('xl/workbook.xml')
  if (!workbook) throw new Error('Not an Excel workbook (.xlsx)')

  const targets = new Map<string, string>()
  for (const rel of text('xl/_rels/workbook.xml.rels')?.matchAll(/<Relationship\b[^>]*\/?>/g) ??
    []) {
    const id = attr(rel[0], 'Id')
    const target = attr(rel[0], 'Target')
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const shared = sharedStrings(text('xl/sharedStrings.xml'))
  const sheets: SheetRows[] = []
  ;[...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].forEach((m, i) => {
    const id = attr(m[0], 'r:id')
    const path = (id && targets.get(id)) ?? `xl/worksheets/sheet${i + 1}.xml`
    const xml = text(path)
    if (xml)
      sheets.push({ name: attr(m[0], 'name') ?? `Sheet${i + 1}`, rows: parseSheet(xml, shared) })
  })
  if (sheets.length === 0) throw new Error('The workbook has no readable sheet')
  return sheets
}

/** The first worksheet of an .xlsx workbook. */
export async function readFirstSheet(bytes: Bytes): Promise<Row[]> {
  return (await readWorkbook(bytes))[0]!.rows
}

/** Comma, semicolon or tab separated text with quoted fields; the delimiter is taken from the first line. */
export function parseCsv(text: string): Row[] {
  const src = text.replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t']
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0]!.d

  const rows: Row[] = []
  let row: Row = []
  let field = ''
  let quoted = false
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) endField()
    else if (ch === '\n') endRow()
    else if (ch !== '\r') field += ch
  }
  if (field !== '' || row.length > 0) endRow()
  // A trailing newline leaves one empty row; drop it, and any other fully empty row keeps its place.
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '')) rows.pop()
  return rows
}
