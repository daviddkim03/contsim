/**
 * Cabinet catalog: 5 items generated from data/catalog.xlsx by
 * scripts/import-catalog.ts (npm run catalog). Do not edit by hand.
 */

export interface CatalogItem {
  /** The catalogue code, e.g. "3036" or "DB18(4)". */
  code: string
  /** Width, depth and height in inches. */
  w: number
  d: number
  h: number
  /** Weight of one cabinet in kilograms, when the catalog gives it. */
  kg?: number
}

export const CATALOG: readonly CatalogItem[] = [
  { code: '18', w: 18, d: 24, h: 34.5, kg: 27 },
  { code: '36', w: 36, d: 24, h: 34.5, kg: 48 },
  { code: '3036', w: 30, d: 12, h: 36, kg: 25 },
  { code: '2442', w: 24, d: 12, h: 42, kg: 24 },
  { code: 'P249624', w: 24, d: 24, h: 96, kg: 86 },
]
