import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../../src/catalog'
import {
  decodeXml,
  parseCsv,
  parseSheet,
  readFirstSheet,
  readWorkbook,
  unzip,
} from '../../src/ui/spreadsheet'
import { percent, writeXlsx } from '../../src/ui/xlsx'
import { zip } from '../../src/ui/zip'

const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('unzip', () => {
  const entries = [
    { name: 'a.txt', data: 'hello' },
    { name: 'b/c.xml', data: '<x/>'.repeat(300) },
  ]

  it('reads back what zip wrote, deflated or stored', async () => {
    for (const deflate of [undefined, null]) {
      const parts = await unzip(await zip(entries, { deflate }))
      expect([...parts.keys()]).toEqual(['a.txt', 'b/c.xml'])
      expect(utf8(parts.get('a.txt')!)).toBe('hello')
      expect(utf8(parts.get('b/c.xml')!)).toBe('<x/>'.repeat(300))
    }
  })

  it('rejects files that are not archives, or are damaged', async () => {
    await expect(unzip(new Uint8Array([1, 2, 3]))).rejects.toThrow('Not a ZIP')
    const bytes = await zip([{ name: 'a.txt', data: 'hello world' }], { deflate: null })
    // The first entry's data starts right after its 30-byte local header and 5-byte name.
    bytes[35] ^= 0xff
    await expect(unzip(bytes)).rejects.toThrow('Damaged ZIP entry a.txt')
  })
})

describe('readWorkbook', () => {
  it('reads every sheet written by writeXlsx, with names and typed cells', async () => {
    const bytes = await writeXlsx({
      sheets: [
        {
          name: 'Order',
          header: ['Code', 'Qty'],
          rows: [
            ['3036', 4],
            [null, 'x'],
            ['A & B <c>', percent(0.5)],
          ],
        },
        { name: 'Guide', header: ['#'], rows: [[1], [true]] },
      ],
    })
    const sheets = await readWorkbook(bytes)
    expect(sheets.map((s) => s.name)).toEqual(['Order', 'Guide'])
    expect(sheets[0]!.rows).toEqual([
      ['Code', 'Qty'],
      ['3036', 4],
      [undefined, 'x'],
      ['A & B <c>', 0.5],
    ])
    expect(sheets[1]!.rows).toEqual([['#'], [1], [true]])
    expect(await readFirstSheet(bytes)).toEqual(sheets[0]!.rows)
  })

  it('reads a workbook saved by Excel, shared strings included', async () => {
    // Written by Excel, so its text lives in a shared string table, unlike ours.
    const bytes = new Uint8Array(readFileSync('tests/fixtures/excel-workbook.xlsx'))
    const rows = await readFirstSheet(bytes)
    expect(rows[0]).toEqual(['TYPE', 'W', 'D', 'H', 'W', 'D', 'H'])
    expect(rows[1]!.slice(0, 4)).toEqual([9, 9, 24, 34.5])
    expect(rows).toHaveLength(175)
    expect(rows[174]![0]).toBe('P368424')
  })

  it('reads the catalog the app ships with', async () => {
    const rows = await readFirstSheet(new Uint8Array(readFileSync('data/catalog.xlsx')))
    expect(rows[0]).toEqual(['TYPE', 'W', 'D', 'H', 'WEIGHT (kg)'])
    expect(rows.slice(1).map((r) => r[0])).toEqual(CATALOG.map((c) => c.code))
  })

  it('rejects files that are not workbooks', async () => {
    const csv = new TextEncoder().encode('code,qty\n3036,1')
    await expect(readWorkbook(csv)).rejects.toThrow('Not an Excel workbook')
    const plainZip = await zip([{ name: 'readme.txt', data: 'nope' }])
    await expect(readWorkbook(plainZip)).rejects.toThrow('Not an Excel workbook')
  })
})

describe('parseSheet', () => {
  it('handles self-closing rows and cells, errors, formulas and row numbers', () => {
    const xml =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>1+1</f><v>2</v></c></row>' +
      '<row r="2"/>' +
      '<row r="4"><c r="A4" t="e"><v>#N/A</v></c><c r="B4" t="str"><v>x &amp; y</v></c><c r="C4"/></row>' +
      '</sheetData>'
    expect(parseSheet(xml, ['hi'])).toEqual([['hi', undefined, 2], [], [], [undefined, 'x & y']])
  })

  it('joins rich-text runs in inline strings', () => {
    const xml =
      '<row r="1"><c r="A1" t="inlineStr"><is><r><t>ab</t></r><r><t>cd</t></r></is></c></row>'
    expect(parseSheet(xml, [])).toEqual([['abcd']])
  })
})

describe('decodeXml', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXml('&amp;&lt;&gt;&quot;&apos;&#65;&#x42;&unknown;')).toBe('&<>"\'AB&unknown;')
  })
})

describe('parseCsv', () => {
  it('splits on the delimiter used in the first line', () => {
    expect(parseCsv('code,qty\n3036,4\n')).toEqual([
      ['code', 'qty'],
      ['3036', '4'],
    ])
    expect(parseCsv('code;qty\r\n3036;4')).toEqual([
      ['code', 'qty'],
      ['3036', '4'],
    ])
    expect(parseCsv('code\tqty\n3036\t4')).toEqual([
      ['code', 'qty'],
      ['3036', '4'],
    ])
  })

  it('handles quotes, embedded delimiters and newlines, and a byte order mark', () => {
    const text = '\uFEFF"Code","Note"\n"DB18(4)","has, comma and ""quotes"""\n"x","multi\nline"'
    expect(parseCsv(text)).toEqual([
      ['Code', 'Note'],
      ['DB18(4)', 'has, comma and "quotes"'],
      ['x', 'multi\nline'],
    ])
  })

  it('keeps empty rows in the middle and drops trailing ones', () => {
    expect(parseCsv('a,b\n\n1,2\n\n\n')).toEqual([['a', 'b'], [''], ['1', '2']])
    expect(parseCsv('')).toEqual([])
  })
})
