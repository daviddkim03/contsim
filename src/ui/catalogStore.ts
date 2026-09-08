/**
 * The catalog the app searches: the built-in items from `src/catalog.ts`
 * (replace `data/catalog.xlsx` and run `npm run catalog` to change them) plus
 * the ones the user saved from a custom box, which live in localStorage.
 *
 * Sizes are inches here, like the built-in catalog; the UI converts.
 */

import { CATALOG, type CatalogItem } from '../catalog'

export const CATALOG_STORAGE_KEY = 'contsim.catalog.v1'

/** Codes are typed into a narrow field and shown in the legend. */
export const MAX_CODE_LENGTH = 24
/** In inches; the core rejects anything larger long before this. */
const MAX_SIDE = 10_000

let storage: Storage | null = null
let userItems: CatalogItem[] = []
let index = new Map<string, CatalogItem>()

/** Codes match regardless of case and spaces, so "db 18" finds "DB18". */
const normalize = (code: string) => code.toUpperCase().replace(/\s+/g, '')

function reindex(): void {
  index = new Map()
  for (const item of [...CATALOG, ...userItems]) index.set(normalize(item.code), item)
}
reindex()

/** Built-in items first, then the saved ones in the order they were added. */
export function catalogItems(): readonly CatalogItem[] {
  return userItems.length === 0 ? CATALOG : [...CATALOG, ...userItems]
}

export function findCatalogItem(code: string): CatalogItem | null {
  return index.get(normalize(code)) ?? null
}

export function isUserCatalogItem(code: string): boolean {
  const key = normalize(code)
  return userItems.some((item) => normalize(item.code) === key)
}

function validItem(value: unknown): CatalogItem | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  if (typeof r.code !== 'string') return null
  const code = r.code.trim()
  if (code === '' || code.length > MAX_CODE_LENGTH) return null
  const sides = [r.w, r.d, r.h]
  if (!sides.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0 && s <= MAX_SIDE)) {
    return null
  }
  const [w, d, h] = sides as [number, number, number]
  return { code, w, d, h }
}

/** Reads saved items back, dropping anything malformed. Null when the JSON is not a list. */
export function parseUserItems(json: string): CatalogItem[] | null {
  try {
    const raw: unknown = JSON.parse(json)
    if (!Array.isArray(raw)) return null
    const items: CatalogItem[] = []
    const seen = new Set<string>()
    for (const entry of raw) {
      const item = validItem(entry)
      const key = item ? normalize(item.code) : ''
      // Built-in codes win, and a code cannot appear twice.
      if (!item || seen.has(key) || CATALOG.some((c) => normalize(c.code) === key)) continue
      seen.add(key)
      items.push(item)
    }
    return items
  } catch {
    return null
  }
}

function persist(): void {
  try {
    storage?.setItem(CATALOG_STORAGE_KEY, JSON.stringify(userItems))
  } catch {
    // Quota or availability problems are not worth interrupting the user for.
  }
}

/** Loads the saved items and remembers where to write them. Call once at startup. */
export function initCatalog(s: Storage | null): void {
  storage = s
  let loaded: CatalogItem[] | null
  try {
    const json = s?.getItem(CATALOG_STORAGE_KEY)
    loaded = json ? parseUserItems(json) : null
  } catch {
    // Storage can be unavailable (private mode, disabled cookies).
    loaded = null
  }
  userItems = loaded ?? []
  reindex()
}

export type AddResult = { ok: true; item: CatalogItem } | { ok: false; error: string }

/** Adds a saved item. The code must be free; sizes are inches. */
export function addUserCatalogItem(
  code: string,
  dims: { w: number; d: number; h: number },
): AddResult {
  const item = validItem({ code, ...dims })
  if (!item) {
    return code.trim().length > MAX_CODE_LENGTH
      ? { ok: false, error: `A catalog name is at most ${MAX_CODE_LENGTH} characters.` }
      : { ok: false, error: 'Give the box a name and a size before saving it to the catalog.' }
  }
  const clash = findCatalogItem(item.code)
  if (clash) return { ok: false, error: `${clash.code} is already in the catalog.` }
  userItems = [...userItems, item]
  reindex()
  persist()
  return { ok: true, item }
}

/** Removes a saved item. Built-in items stay; returns false when nothing was removed. */
export function removeUserCatalogItem(code: string): boolean {
  const key = normalize(code)
  const next = userItems.filter((item) => normalize(item.code) !== key)
  if (next.length === userItems.length) return false
  userItems = next
  reindex()
  persist()
  return true
}

/** Forgets the saved items without touching storage. For tests. */
export function resetUserCatalog(): void {
  storage = null
  userItems = []
  reindex()
}
