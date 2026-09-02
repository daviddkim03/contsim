import { describe, expect, it } from 'vitest'
import { crc32, platformDeflate, zip, type ZipEntry } from '../../src/ui/zip'
import { text, unzip } from '../helpers/unzip'

const entries: ZipEntry[] = [
  { name: 'hello.txt', data: 'hello world' },
  { name: 'dir/répété.xml', data: '<a>'.repeat(500) },
  { name: 'bytes.bin', data: new Uint8Array([0, 1, 2, 255]) },
]

describe('crc32', () => {
  it('matches the reference value for "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('zip', () => {
  it('round-trips entries through an independent reader that checks every CRC', async () => {
    const files = unzip(await zip(entries))
    expect([...files.keys()]).toEqual(['hello.txt', 'dir/répété.xml', 'bytes.bin'])
    expect(text(files.get('hello.txt')!)).toBe('hello world')
    expect(text(files.get('dir/répété.xml')!)).toBe('<a>'.repeat(500))
    expect([...files.get('bytes.bin')!.data]).toEqual([0, 1, 2, 255])
  })

  it('deflates repetitive content and stores what would not shrink', async () => {
    const files = unzip(await zip(entries))
    expect(files.get('dir/répété.xml')!.method).toBe(8)
    expect(files.get('hello.txt')!.method).toBe(0)
    expect(files.get('bytes.bin')!.method).toBe(0)
  })

  it('stores everything when no deflate implementation is available', async () => {
    const files = unzip(await zip(entries, { deflate: null }))
    for (const entry of files.values()) expect(entry.method).toBe(0)
    expect(text(files.get('dir/répété.xml')!)).toBe('<a>'.repeat(500))
  })

  it('is byte-for-byte deterministic for a fixed date', async () => {
    const date = new Date(2026, 8, 2, 12, 0, 0)
    expect(await zip(entries, { date })).toEqual(await zip(entries, { date }))
  })

  it('writes a valid empty archive', () => {
    return expect(zip([], { deflate: null }).then(unzip)).resolves.toEqual(new Map())
  })

  it('finds a deflate implementation on this platform', () => {
    expect(platformDeflate()).not.toBeNull()
  })
})
