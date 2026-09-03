/**
 * Looking things up in the cabinet catalog: unit conversion of its inch
 * dimensions, and the search behind the box picker (by code or by size).
 */

import { CATALOG, type CatalogItem } from '../catalog'
import type { Dims } from '../core'
import type { Unit } from './units'

const PER_INCH: Record<Unit, number> = { in: 1, ft: 1 / 12, mm: 25.4, cm: 2.54, m: 0.0254 }
/** Decimals that keep every catalog size exact in that unit (34.5 in = 876.3 mm = 2.875 ft). */
const DECIMALS: Record<Unit, number> = { in: 3, ft: 3, mm: 1, cm: 2, m: 3 }

export function inchesToUnit(inches: number, unit: Unit): number {
  return Number((inches * PER_INCH[unit]).toFixed(DECIMALS[unit]))
}

const byCode = new Map(CATALOG.map((item) => [item.code, item]))

export function findCatalogItem(code: string): CatalogItem | null {
  return byCode.get(code) ?? null
}

/** Width runs along the container's length, depth along its width, height is up. */
export function catalogDims(item: CatalogItem, unit: Unit): Dims {
  return {
    l: inchesToUnit(item.w, unit),
    w: inchesToUnit(item.d, unit),
    h: inchesToUnit(item.h, unit),
  }
}

export function catalogTexts(item: CatalogItem, unit: Unit): { l: string; w: string; h: string } {
  const d = catalogDims(item, unit)
  return { l: String(d.l), w: String(d.w), h: String(d.h) }
}

/** "30 × 12 × 36 in": width x depth x height in the unit. */
export function formatCatalogDims(item: CatalogItem, unit: Unit): string {
  const d = catalogDims(item, unit)
  return `${d.l} × ${d.w} × ${d.h} ${unit}`
}

export interface CatalogSearchResult {
  items: CatalogItem[]
  /** Matches beyond the returned ones. */
  more: number
}

/** Query words are separated by spaces, commas, or the x between dimensions ("30x12", "DB 18"). */
const SEPARATORS = /[\s,×x*]+/i

/**
 * Ranks how well one query word matches an item: exact code, code prefix,
 * code substring, exact dimension, dimension prefix; null when it does not
 * match at all. Dimensions are compared in the display unit and in inches.
 */
function wordRank(word: string, code: string, dims: string[]): number | null {
  if (code === word) return 0
  if (code.startsWith(word)) return 1
  if (code.includes(word)) return 2
  if (dims.some((d) => d === word)) return 3
  if (dims.some((d) => d.startsWith(word))) return 4
  return null
}

/**
 * Items matching every word of the query, best matches first, then catalog
 * order. Sizes typed in the catalog's own order (width, depth, height) rank
 * above the same numbers in another order. An empty query lists the whole
 * catalog.
 */
export function searchCatalog(query: string, unit: Unit, limit = 40): CatalogSearchResult {
  const words = query.toLowerCase().split(SEPARATORS).filter(Boolean)
  const ranked: { item: CatalogItem; rank: number; index: number }[] = []
  CATALOG.forEach((item, index) => {
    if (words.length === 0) {
      ranked.push({ item, rank: 0, index })
      return
    }
    const code = item.code.toLowerCase()
    const d = catalogDims(item, unit)
    const shown = [d.l, d.w, d.h].map(String)
    const inches = [item.w, item.d, item.h].map(String)
    let rank = 0
    for (const word of words) {
      const r = wordRank(word, code, [...shown, ...inches])
      if (r === null) return
      rank += r
    }
    const inOrder = words.every((w, i) => shown[i] === w || inches[i] === w)
    if (inOrder) rank -= words.length
    ranked.push({ item, rank, index })
  })
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return {
    items: ranked.slice(0, limit).map((r) => r.item),
    more: Math.max(0, ranked.length - limit),
  }
}
