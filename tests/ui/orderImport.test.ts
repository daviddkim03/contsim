import { describe, expect, it } from 'vitest'
import {
  ORDER_FORMAT_GUIDE,
  convertLength,
  importOrder,
  importWorkbook,
  orderTemplate,
  parseHeader,
  readSummary,
} from '../../src/ui/orderImport'
import { buildReport } from '../../src/ui/report'
import { parseCsv, readWorkbook } from '../../src/ui/spreadsheet'
import {
  DEFAULT_OPTIMIZE,
  DEFAULT_VIEW,
  derive,
  edits,
  exampleDraft,
  type Draft,
} from '../../src/ui/state'
import { writeXlsx } from '../../src/ui/xlsx'

const run = (text: string, unit: 'in' | 'cm' | 'mm' = 'in') => importOrder(parseCsv(text), unit, [])

const stateOf = (draft: Draft) => ({
  draft,
  derived: derive(draft),
  view: DEFAULT_VIEW,
  optimize: DEFAULT_OPTIMIZE,
})

describe('parseHeader', () => {
  it('recognizes the column words, case and punctuation aside, with an optional unit', () => {
    expect(parseHeader('Code')).toEqual({ column: 'code', word: 'code', unit: null })
    expect(parseHeader(' QTY. ')).toMatchObject({ column: 'qty' })
    expect(parseHeader('Width (mm)')).toEqual({ column: 'first', word: 'width', unit: 'mm' })
    expect(parseHeader('Depth in')).toEqual({ column: 'second', word: 'depth', unit: 'in' })
    expect(parseHeader('Height (inches)')).toMatchObject({ column: 'third', unit: 'in' })
    expect(parseHeader('Requested')).toMatchObject({ column: 'qty' })
    expect(parseHeader('Colour')).toMatchObject({ column: 'color' })
    expect(parseHeader('Note')).toBeNull()
    expect(parseHeader(undefined)).toBeNull()
    expect(parseHeader(42)).toBeNull()
  })
})

describe('convertLength', () => {
  it('goes through millimetres and keeps three decimals', () => {
    expect(convertLength(40, 'in', 'mm')).toBe(1016)
    expect(convertLength(1016, 'mm', 'in')).toBe(40)
    expect(convertLength(1, 'ft', 'cm')).toBe(30.48)
    expect(convertLength(34.5, 'in', 'm')).toBe(0.876)
    expect(convertLength(7, 'cm', 'cm')).toBe(7)
  })
})

describe('importOrder', () => {
  it('turns catalog codes and custom sizes into box rows', () => {
    const r = run('Code,Qty,Width,Depth,Height,Note\n3036,4,,,,x\ndb18(4),2,,,\nCrate,1,40,30,20\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(
      r.imported.types.map((t) => [t.kind, t.name, t.catalogCode, t.qty, t.l, t.w, t.h]),
    ).toEqual([
      ['catalog', '3036', '3036', '4', '30', '12', '36'],
      ['catalog', 'DB18(4)', 'DB18(4)', '2', '18', '24', '34.5'],
      ['custom', 'Crate', '', '1', '40', '30', '20'],
    ])
    expect(r.imported.boxes).toBe(7)
    expect(r.imported.notes).toEqual([])
    expect(r.imported.container).toBeNull()
    expect(new Set(r.imported.types.map((t) => t.color)).size).toBe(3)
    expect(new Set(r.imported.types.map((t) => t.id)).size).toBe(3)
  })

  it('finds the header below title rows and accepts other column names', () => {
    const r = run('Kitchen order\n\nItem,Quantity\n3036,1')
    expect(r.ok && r.imported.types[0]!.catalogCode).toBe('3036')
  })

  it('converts sizes from the unit in the header into the app unit', () => {
    const r = run('code,qty,width (mm),depth (mm),height (mm)\nCrate,1,1016,762,508')
    expect(r.ok && r.imported.types[0]).toMatchObject({ kind: 'custom', l: '40', w: '30', h: '20' })
    const cm = run('code,qty,w,d,h\nCrate,1,40,30,20', 'cm')
    expect(cm.ok && cm.imported.types[0]).toMatchObject({ l: '40', w: '30', h: '20' })
    const catalogInCm = run('code,qty\n3036,1', 'cm')
    expect(catalogInCm.ok && catalogInCm.imported.types[0]).toMatchObject({
      l: '76.2',
      w: '30.48',
      h: '91.44',
    })
  })

  it('reads Length and Width side by side as the first and second size', () => {
    const r = run('Box,Requested,Length (in),Width (in),Height (in)\nCrate,1,40,30,20')
    expect(r.ok && r.imported.types[0]).toMatchObject({ l: '40', w: '30', h: '20' })
    const swapped = run('Box,Requested,Width,Length,Height\nCrate,1,30,40,20')
    expect(swapped.ok && swapped.imported.types[0]).toMatchObject({ l: '40', w: '30', h: '20' })
  })

  it('adds up duplicate codes and explains skipped rows', () => {
    const r = run('code,qty,w,d,h\n3036,1\n3036,2\n,5\nDB18,x\nMystery,1,,,\nGhost,1,10,10,\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.imported.types).toHaveLength(1)
    expect(r.imported.types[0]!.qty).toBe('3')
    expect(r.imported.notes).toEqual([
      '3036 appears more than once; quantities added',
      'Row 4: no code, skipped',
      'Row 5 (DB18): quantity "x" is not a whole number, skipped',
      'Row 6: "Mystery" is not in the catalog and has no complete size, skipped',
      'Row 7: "Ghost" is not in the catalog and has no complete size, skipped',
    ])
  })

  it('accepts fractions, unit suffixes, decimal commas and numeric cells', () => {
    const r = importOrder(
      [
        ['code', 'qty', 'w', 'd', 'h'],
        ['Crate', 2, '34 1/2', '36"', 20.25],
        ['Bin', '1', '10,5', '10 in', '3'],
      ],
      'in',
      [],
    )
    expect(r.ok && r.imported.types[0]).toMatchObject({ l: '34.5', w: '36', h: '20.25', qty: '2' })
    expect(r.ok && r.imported.types[1]).toMatchObject({ l: '10.5', w: '10', h: '3', qty: '1' })
  })

  it('keeps a valid color column and ignores anything else', () => {
    const r = run('code,qty,color\n3036,1,#ABCDEF\nDB18,1,red')
    expect(r.ok && r.imported.types[0]!.color).toBe('#abcdef')
    expect(r.ok && r.imported.types[1]!.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(r.ok && r.imported.types[1]!.color).not.toBe('red')
  })

  it('rejects sheets without a usable header or rows', () => {
    expect(run('foo,bar\n1,2')).toMatchObject({
      ok: false,
      error: expect.stringContaining('No header row'),
    })
    expect(run('code,qty\n,\nMystery,1')).toMatchObject({
      ok: false,
      error: expect.stringContaining('No usable rows'),
    })
  })
})

describe('importWorkbook', () => {
  it('round-trips the Excel export: boxes, container, unit and upright', async () => {
    let draft = edits.setContainerType(exampleDraft(), '40ft-hc')
    draft = edits.setKeepUpright(draft, true)
    draft = edits.setUnit(draft, 'cm')
    const bytes = await writeXlsx(buildReport(stateOf(draft))!)
    const r = importWorkbook(await readWorkbook(bytes), 'in', [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.imported.container).toEqual({
      containerType: '40ft-hc',
      container: null,
      unit: 'cm',
      keepUpright: true,
    })
    expect(r.imported.types.map((t) => [t.kind, t.catalogCode, t.qty, t.color])).toEqual(
      draft.types.map((t) => [t.kind, t.catalogCode, t.qty, t.color]),
    )
    expect(r.imported.types[0]).toMatchObject({ l: '91.44', w: '60.96', h: '87.63' })
    expect(r.imported.boxes).toBe(150)
    expect(r.imported.notes).toEqual([])
  })

  it('restores a custom container and custom boxes from the export', async () => {
    let draft = edits.setContainerType(exampleDraft(), 'custom')
    draft = edits.addType(draft)
    const id = draft.types[10]!.id
    draft = edits.setCustom(draft, id, 'Crate')
    draft = edits.setTypeField(draft, id, 'l', '40')
    draft = edits.setTypeField(draft, id, 'w', '30')
    draft = edits.setTypeField(draft, id, 'h', '20')
    draft = edits.setTypeField(draft, id, 'qty', '3')
    const bytes = await writeXlsx(buildReport(stateOf(draft))!)
    const r = importWorkbook(await readWorkbook(bytes), 'mm', [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.imported.container).toEqual({
      containerType: 'custom',
      container: { l: '232.2', w: '92.6', h: '94.2' },
      unit: 'in',
      keepUpright: false,
    })
    expect(r.imported.types[10]).toMatchObject({
      kind: 'custom',
      name: 'Crate',
      l: '40',
      w: '30',
      h: '20',
      qty: '3',
    })
  })

  it('treats a workbook without Boxes and Summary sheets as an order in its first sheet', async () => {
    const bytes = await writeXlsx(orderTemplate('in'))
    const r = importWorkbook(await readWorkbook(bytes), 'in', [])
    expect(r.ok && r.imported.types.map((t) => [t.kind, t.name, t.qty, t.l])).toEqual([
      ['catalog', '3036', '4', '30'],
      ['catalog', 'DB18(4)', '2', '18'],
      ['custom', 'Crate', '1', '40'],
    ])
  })
})

describe('readSummary', () => {
  it('names a preset, or gives custom dimensions, with unit and upright', () => {
    expect(
      readSummary(
        [
          ['Unit', 'mm'],
          ['Container type', '20 ft high cube'],
          ['Keep boxes upright', 'Yes'],
        ],
        'in',
      ),
    ).toEqual({ containerType: '20ft-hc', container: null, unit: 'mm', keepUpright: true })
    expect(
      readSummary(
        [
          ['Container type', 'custom'],
          ['Container length (in)', 100],
          ['Container width (in)', '50'],
          ['Container height (in)', 40.5],
          ['Keep boxes upright', 'No'],
        ],
        'in',
      ),
    ).toEqual({
      containerType: 'custom',
      container: { l: '100', w: '50', h: '40.5' },
      unit: 'in',
      keepUpright: false,
    })
    expect(readSummary([['Container type', 'custom']], 'in')).toBeNull()
    expect(readSummary([['Item', 'Value']], 'in')).toBeNull()
  })
})

describe('orderTemplate', () => {
  it('lists the guide and example sizes in the chosen unit', () => {
    const wb = orderTemplate('mm')
    expect(wb.sheets.map((s) => s.name)).toEqual(['Order', 'Guide'])
    expect(wb.sheets[0]!.header[2]).toBe('Width (mm)')
    expect(wb.sheets[0]!.rows[2]!.slice(2, 5)).toEqual([1016, 762, 508])
    expect(wb.sheets[1]!.rows).toHaveLength(ORDER_FORMAT_GUIDE.length)
  })
})
