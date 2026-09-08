import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CATALOG } from '../../src/catalog'
import {
  CATALOG_STORAGE_KEY,
  MAX_CODE_LENGTH,
  addUserCatalogItem,
  catalogItems,
  findCatalogItem,
  initCatalog,
  isUserCatalogItem,
  parseUserItems,
  removeUserCatalogItem,
  resetUserCatalog,
} from '../../src/ui/catalogStore'

function fakeStorage(seed?: string): Storage {
  const map = new Map<string, string>()
  if (seed !== undefined) map.set(CATALOG_STORAGE_KEY, seed)
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const crate = { w: 40, d: 30, h: 20 }

beforeEach(() => resetUserCatalog())
afterEach(() => resetUserCatalog())

describe('the built-in catalog', () => {
  it('is a short list of placeholders that can be looked up by code', () => {
    expect(catalogItems()).toEqual(CATALOG)
    expect(findCatalogItem('3036')).toEqual({ code: '3036', w: 30, d: 12, h: 36 })
    expect(findCatalogItem('nope')).toBeNull()
    expect(isUserCatalogItem('3036')).toBe(false)
  })

  it('matches codes regardless of case and spaces', () => {
    expect(findCatalogItem('p249624')?.code).toBe('P249624')
    expect(findCatalogItem(' P24 9624 ')?.code).toBe('P249624')
  })
})

describe('saved items', () => {
  it('are added to the end of the catalog and found like any other', () => {
    const added = addUserCatalogItem('Crate', crate)
    expect(added).toEqual({ ok: true, item: { code: 'Crate', ...crate } })
    expect(catalogItems()).toHaveLength(CATALOG.length + 1)
    expect(catalogItems().at(-1)!.code).toBe('Crate')
    expect(findCatalogItem('crate')).toEqual({ code: 'Crate', ...crate })
    expect(isUserCatalogItem('CRATE')).toBe(true)
  })

  it('refuse a code that is taken, a missing name or an impossible size', () => {
    addUserCatalogItem('Crate', crate)
    expect(addUserCatalogItem('crate', crate)).toEqual({
      ok: false,
      error: 'Crate is already in the catalog.',
    })
    expect(addUserCatalogItem('3036', crate)).toMatchObject({ ok: false })
    expect(addUserCatalogItem('  ', crate)).toMatchObject({ ok: false })
    expect(addUserCatalogItem('Bad', { ...crate, h: 0 })).toMatchObject({ ok: false })
    expect(addUserCatalogItem('Bad', { ...crate, h: NaN })).toMatchObject({ ok: false })
    expect(addUserCatalogItem('x'.repeat(MAX_CODE_LENGTH + 1), crate)).toMatchObject({
      ok: false,
      error: expect.stringContaining(String(MAX_CODE_LENGTH)),
    })
    expect(catalogItems()).toHaveLength(CATALOG.length + 1)
  })

  it('are removed by code, built-in ones are not', () => {
    addUserCatalogItem('Crate', crate)
    expect(removeUserCatalogItem('3036')).toBe(false)
    expect(removeUserCatalogItem('nope')).toBe(false)
    expect(removeUserCatalogItem('crate')).toBe(true)
    expect(findCatalogItem('Crate')).toBeNull()
    expect(catalogItems()).toEqual(CATALOG)
  })

  it('are trimmed and keep their name as typed', () => {
    expect(addUserCatalogItem('  Tall Pantry  ', crate)).toMatchObject({
      ok: true,
      item: { code: 'Tall Pantry' },
    })
    expect(findCatalogItem('tallpantry')?.code).toBe('Tall Pantry')
  })
})

describe('persistence', () => {
  it('writes every change and reads it back', () => {
    const storage = fakeStorage()
    initCatalog(storage)
    addUserCatalogItem('Crate', crate)
    addUserCatalogItem('Bin', { w: 10, d: 10, h: 10 })
    removeUserCatalogItem('Crate')
    expect(JSON.parse(storage.getItem(CATALOG_STORAGE_KEY)!)).toEqual([
      { code: 'Bin', w: 10, d: 10, h: 10 },
    ])

    resetUserCatalog()
    expect(findCatalogItem('Bin')).toBeNull()
    initCatalog(storage)
    expect(findCatalogItem('Bin')).toEqual({ code: 'Bin', w: 10, d: 10, h: 10 })
  })

  it('survives storage that is empty, unavailable or corrupt', () => {
    initCatalog(null)
    expect(catalogItems()).toEqual(CATALOG)
    initCatalog(fakeStorage('{not json'))
    expect(catalogItems()).toEqual(CATALOG)
    initCatalog(fakeStorage('"nope"'))
    expect(catalogItems()).toEqual(CATALOG)
  })

  it('drops saved entries that are malformed, duplicated or shadow a built-in code', () => {
    expect(
      parseUserItems(
        JSON.stringify([
          { code: 'Crate', ...crate },
          { code: 'Crate', w: 1, d: 1, h: 1 },
          { code: '3036', w: 1, d: 1, h: 1 },
          { code: 'Bad', w: 'x', d: 1, h: 1 },
          { code: '', w: 1, d: 1, h: 1 },
          null,
          { code: 'Bin', w: 10, d: 10, h: 10 },
        ]),
      ),
    ).toEqual([
      { code: 'Crate', ...crate },
      { code: 'Bin', w: 10, d: 10, h: 10 },
    ])
    expect(parseUserItems('{}')).toBeNull()
    expect(parseUserItems('[]')).toEqual([])
  })
})
