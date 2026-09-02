/**
 * Minimal ZIP writer: just enough to package an .xlsx (which is a ZIP of XML
 * parts). Entries are deflated with the platform's CompressionStream when it
 * exists and stored uncompressed otherwise; both produce a valid archive that
 * Excel, LibreOffice, Numbers and Google Sheets read.
 *
 * Layout (PKWARE APPNOTE): one local header + data per entry, then the central
 * directory, then the end-of-central-directory record. Sizes stay well below
 * the 4 GB ZIP64 threshold.
 */

/** Bytes backed by a plain ArrayBuffer, which is what Blob and the streams API accept. */
export type Bytes = Uint8Array<ArrayBuffer>

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string
  data: Bytes | string
}

export type Deflate = (data: Bytes) => Promise<Bytes>

export interface ZipOptions {
  /** Raw deflate implementation. Omit for the platform's, null to store everything. */
  deflate?: Deflate | null
  /** Modification time stamped on every entry. Defaults to now. */
  date?: Date
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Raw deflate through CompressionStream, or null where the platform lacks it. */
export function platformDeflate(): Deflate | null {
  if (typeof CompressionStream === 'undefined') return null
  return async (data) => {
    const stream = new CompressionStream('deflate-raw')
    const output = new Response(stream.readable).arrayBuffer()
    const writer = stream.writable.getWriter()
    await writer.write(data)
    await writer.close()
    return new Uint8Array(await output)
  }
}

const STORED = 0
const DEFLATED = 8
const VERSION = 20
const UTF8_NAMES = 0x0800

/** MS-DOS date and time fields; the format has no notion of years before 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

class ByteWriter {
  private buffer = new Uint8Array(1024)
  private view = new DataView(this.buffer.buffer)
  length = 0

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return
    let size = this.buffer.length * 2
    while (size < this.length + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buffer)
    this.buffer = next
    this.view = new DataView(next.buffer)
  }

  u16(value: number): void {
    this.reserve(2)
    this.view.setUint16(this.length, value, true)
    this.length += 2
  }

  u32(value: number): void {
    this.reserve(4)
    this.view.setUint32(this.length, value, true)
    this.length += 4
  }

  bytes(data: Uint8Array): void {
    this.reserve(data.length)
    this.buffer.set(data, this.length)
    this.length += data.length
  }

  result(): Bytes {
    return this.buffer.slice(0, this.length)
  }
}

interface Prepared {
  name: Bytes
  method: number
  crc: number
  size: number
  data: Bytes
}

async function prepare(entry: ZipEntry, deflate: Deflate | null): Promise<Prepared> {
  const raw = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data
  const compressed = deflate ? await deflate(raw) : null
  const useDeflate = compressed !== null && compressed.length < raw.length
  return {
    name: new TextEncoder().encode(entry.name),
    method: useDeflate ? DEFLATED : STORED,
    crc: crc32(raw),
    size: raw.length,
    data: useDeflate ? compressed : raw,
  }
}

export async function zip(entries: ZipEntry[], options: ZipOptions = {}): Promise<Bytes> {
  const deflate = options.deflate === undefined ? platformDeflate() : options.deflate
  const stamp = dosDateTime(options.date ?? new Date())
  const prepared = await Promise.all(entries.map((e) => prepare(e, deflate)))

  const out = new ByteWriter()
  const offsets: number[] = []
  for (const p of prepared) {
    offsets.push(out.length)
    out.u32(0x04034b50)
    out.u16(VERSION)
    out.u16(UTF8_NAMES)
    out.u16(p.method)
    out.u16(stamp.time)
    out.u16(stamp.date)
    out.u32(p.crc)
    out.u32(p.data.length)
    out.u32(p.size)
    out.u16(p.name.length)
    out.u16(0)
    out.bytes(p.name)
    out.bytes(p.data)
  }

  const directoryOffset = out.length
  prepared.forEach((p, i) => {
    out.u32(0x02014b50)
    out.u16(VERSION)
    out.u16(VERSION)
    out.u16(UTF8_NAMES)
    out.u16(p.method)
    out.u16(stamp.time)
    out.u16(stamp.date)
    out.u32(p.crc)
    out.u32(p.data.length)
    out.u32(p.size)
    out.u16(p.name.length)
    out.u16(0)
    out.u16(0)
    out.u16(0)
    out.u16(0)
    out.u32(0)
    out.u32(offsets[i]!)
    out.bytes(p.name)
  })
  const directorySize = out.length - directoryOffset

  out.u32(0x06054b50)
  out.u16(0)
  out.u16(0)
  out.u16(prepared.length)
  out.u16(prepared.length)
  out.u32(directorySize)
  out.u32(directoryOffset)
  out.u16(0)
  return out.result()
}
