import { describe, expect, it } from 'vitest'
import { CATALOG } from '../../src/catalog'
import {
  catalogDims,
  findCatalogItem,
  formatCatalogDims,
  inchesToUnit,
  searchCatalog,
} from '../../src/ui/catalogSearch'

describe('catalog', () => {
  it('has unique codes and positive sizes', () => {
    expect(CATALOG.length).toBeGreaterThan(100)
    expect(new Set(CATALOG.map((c) => c.code)).size).toBe(CATALOG.length)
    for (const c of CATALOG) {
      expect(c.w).toBeGreaterThan(0)
      expect(c.d).toBeGreaterThan(0)
      expect(c.h).toBeGreaterThan(0)
    }
    expect(findCatalogItem('3036')).toEqual({ code: '3036', w: 30, d: 12, h: 36 })
    expect(findCatalogItem('nope')).toBeNull()
  })

  it('converts inches exactly into every unit', () => {
    expect(inchesToUnit(34.5, 'in')).toBe(34.5)
    expect(inchesToUnit(34.5, 'ft')).toBe(2.875)
    expect(inchesToUnit(34.5, 'mm')).toBe(876.3)
    expect(inchesToUnit(34.5, 'cm')).toBe(87.63)
    expect(inchesToUnit(34.5, 'm')).toBe(0.876)
    expect(inchesToUnit(24, 'mm')).toBe(609.6)
  })

  it('maps width to length, depth to width, and formats the size', () => {
    const item = findCatalogItem('3036')!
    expect(catalogDims(item, 'in')).toEqual({ l: 30, w: 12, h: 36 })
    expect(formatCatalogDims(item, 'in')).toBe('30 × 12 × 36 in')
    expect(formatCatalogDims(item, 'mm')).toBe('762 × 304.8 × 914.4 mm')
  })
})

describe('searchCatalog', () => {
  const codes = (query: string, unit: 'in' | 'mm' = 'in', limit?: number) =>
    searchCatalog(query, unit, limit).items.map((i) => i.code)

  it('lists the whole catalog for an empty query, up to the limit', () => {
    const all = searchCatalog('', 'in')
    expect(all.items).toHaveLength(40)
    expect(all.more).toBe(CATALOG.length - 40)
    expect(all.items[0]!.code).toBe('9')
    expect(searchCatalog('', 'in', 10).items).toHaveLength(10)
  })

  it('finds a code exactly, then by prefix, then anywhere in the code', () => {
    expect(codes('3036')).toEqual(['3036'])
    const db = codes('db')
    expect(db[0]).toBe('DB9')
    expect(db.every((c) => c.includes('DB'))).toBe(true)
    expect(db.indexOf('VDB9')).toBeGreaterThan(db.indexOf('DB30'))
    expect(codes('P24')).toEqual(['P249624', 'P249024', 'P248424'])
  })

  it('finds cabinets by size, in any order and with x between numbers', () => {
    expect(codes('30 12 36')[0]).toBe('3036')
    expect(codes('30x12x36')[0]).toBe('3036')
    expect(codes('36 x 12 x 30')).toContain('3036')
    const base24 = codes('24x34.5')
    expect(base24[0]).toBe('24')
    expect(base24).toContain('DB24')
    expect(base24).toContain('VB24')
    expect(base24).not.toContain('3036')
  })

  it('matches sizes typed in the display unit', () => {
    expect(codes('876.3', 'mm')).toContain('9')
    const wide = searchCatalog('762 304.8', 'mm').items
    expect(wide[0]!.code).toBe('3042')
    for (const item of wide) {
      const mm = [item.w, item.d, item.h].map((v) => inchesToUnit(v, 'mm'))
      expect(mm).toContain(762)
      expect(mm).toContain(304.8)
    }
  })

  it('returns nothing for nonsense', () => {
    expect(searchCatalog('zzz', 'in')).toEqual({ items: [], more: 0 })
  })
})
