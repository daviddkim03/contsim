/**
 * Independent readers for what the app writes: a ZIP parser that verifies
 * every CRC with Node's own implementation, and a worksheet reader that turns
 * SpreadsheetML cells back into values. Used by unit and e2e tests.
 */

import { crc32, inflateRawSync } from 'node:zlib'

export interface Entry {
  name: string
  /** 0 stored, 8 deflated. */
  method: number
  data: Uint8Array
}

export function unzip(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('No end-of-central-directory record')
  const count = view.getUint16(eocd + 10, true)
  if (view.getUint16(eocd + 8, true) !== count) throw new Error('Entry counts disagree')
  const directoryOffset = view.getUint32(eocd + 16, true)
  if (view.getUint32(eocd + 12, true) !== eocd - directoryOffset) {
    throw new Error('Central directory size does not match its offset')
  }

  const entries = new Map<string, Entry>()
  let p = directoryOffset
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Bad central directory header')
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const compressedSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLength = view.getUint16(p + 28, true)
    const extraLength = view.getUint16(p + 30, true)
    const commentLength = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength))
    p += 46 + nameLength + extraLength + commentLength

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Bad local header')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(start, start + compressedSize)
    let data: Uint8Array
    if (method === 8) data = new Uint8Array(inflateRawSync(raw))
    else if (method === 0) data = raw
    else throw new Error(`Unsupported compression method ${method}`)
    if (data.length !== size) throw new Error(`Size mismatch for ${name}`)
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`)
    entries.set(name, { name, method, data })
  }
  return entries
}

export const text = (entry: Entry): string => new TextDecoder().decode(entry.data)

export type Value = string | number | boolean

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

function columnIndex(label: string): number {
  let n = 0
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Cell values of a worksheet, by row then column. Skipped cells leave holes. */
export function readSheet(xml: string): Value[][] {
  const rows: Value[][] = []
  for (const row of xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)) {
    const cells: Value[] = []
    for (const cell of row[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/g)) {
      const [, column, attrs, inner] = cell
      const index = columnIndex(column!)
      if (attrs!.includes('t="inlineStr"')) {
        cells[index] = unescapeXml(/<t[^>]*>(.*?)<\/t>/.exec(inner!)?.[1] ?? '')
      } else if (attrs!.includes('t="b"')) {
        cells[index] = /<v>1<\/v>/.test(inner!)
      } else {
        cells[index] = Number(/<v>(.*?)<\/v>/.exec(inner!)?.[1])
      }
    }
    rows.push(cells)
  }
  return rows
}
