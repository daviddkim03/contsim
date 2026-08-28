import { describe, expect, it } from 'vitest'
import {
  Store,
  STORAGE_KEY,
  derive,
  draftFromScenario,
  edits,
  exampleDraft,
  loadDraft,
  parseDraft,
  saveDraft,
  type Draft,
} from '../../src/ui/state'
import { mixedScenario } from '../../src/scenarios'

const mixed = () => draftFromScenario(mixedScenario(), 'in')

function fakeStorage(): Storage {
  const map = new Map<string, string>()
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

describe('derive', () => {
  it('packs a valid draft', () => {
    const d = derive(mixed())
    expect(d.issues).toEqual({})
    expect(d.scale).toBe(1)
    expect(d.result?.status).toBe('fits')
    expect(d.scenario?.types).toHaveLength(5)
  })

  it('scales decimals to integers for the core', () => {
    const draft = edits.setContainer(mixed(), 'l', '232.5')
    const d = derive(draft)
    expect(d.scale).toBe(10)
    expect(d.scenario?.container).toEqual({ l: 2325, w: 920, h: 940 })
    expect(d.scenario?.types[0]?.dims).toEqual({ l: 480, w: 400, h: 480 })
  })

  it('flags unparsable and invalid fields without packing', () => {
    let draft = edits.setContainer(mixed(), 'w', 'abc')
    draft = edits.setTypeField(draft, 'pallet', 'h', '0')
    draft = edits.setTypeField(draft, 'crate', 'qty', '2.5')
    const d = derive(draft)
    expect(d.issues).toEqual({
      'container.w': 'Enter a number',
      'types[0].dims.h': 'Must be a positive integer',
      'types[1].qty': 'Enter a whole number',
    })
    expect(d.result).toBeNull()
    expect(d.scenario).toBeNull()
  })

  it('falls back to a generated name for a blank one', () => {
    const d = derive(edits.setTypeField(mixed(), 'tote', 'name', '  '))
    expect(d.scenario?.types[3]?.name).toBe('Box 4')
  })

  it('never throws on garbage input', () => {
    const draft: Draft = {
      container: { l: '', w: '-', h: '9'.repeat(30) },
      types: [{ id: 'x', name: '', l: '.', w: '1', h: '1', qty: '-3', color: '#000' }],
      keepUpright: true,
      unit: 'mm',
    }
    expect(() => derive(draft)).not.toThrow()
    expect(derive(draft).result).toBeNull()
  })
})

describe('edits', () => {
  it('addType appends a box with a fresh id, name and color', () => {
    const draft = edits.addType(mixed())
    const added = draft.types[5]!
    expect(draft.types).toHaveLength(6)
    expect(added.name).toBe('Box A')
    expect(added.qty).toBe('1')
    expect(new Set(draft.types.map((t) => t.id)).size).toBe(6)
    expect(mixed().types.map((t) => t.color)).not.toContain(added.color)
  })

  it('removeType drops exactly that box', () => {
    const draft = edits.removeType(mixed(), 'crate')
    expect(draft.types.map((t) => t.id)).toEqual(['pallet', 'medium', 'tote', 'small'])
  })

  it('stepQty clamps at zero and treats unparsable input as zero', () => {
    let draft = edits.setTypeField(mixed(), 'crate', 'qty', '1')
    draft = edits.stepQty(draft, 'crate', -1)
    expect(draft.types[1]?.qty).toBe('0')
    draft = edits.stepQty(draft, 'crate', -1)
    expect(draft.types[1]?.qty).toBe('0')
    draft = edits.setTypeField(draft, 'crate', 'qty', 'x')
    expect(edits.stepQty(draft, 'crate', 1).types[1]?.qty).toBe('1')
  })

  it('setQuantities writes several quantities at once', () => {
    const draft = edits.setQuantities(mixed(), { pallet: 3, small: 0 })
    expect(draft.types.map((t) => t.qty)).toEqual(['3', '3', '20', '10', '0'])
  })

  it('does not mutate the previous draft', () => {
    const before = mixed()
    const json = JSON.stringify(before)
    edits.setContainer(before, 'l', '1')
    edits.addType(before)
    edits.stepQty(before, 'pallet', 1)
    expect(JSON.stringify(before)).toBe(json)
  })
})

describe('persistence', () => {
  it('round-trips a draft through storage', () => {
    const storage = fakeStorage()
    const draft = edits.setUnit(mixed(), 'cm')
    saveDraft(storage, draft)
    expect(loadDraft(storage)).toEqual(draft)
    expect(storage.getItem(STORAGE_KEY)).toBeTruthy()
  })

  it('falls back to the example when storage is empty, missing or corrupt', () => {
    expect(loadDraft(null)).toEqual(exampleDraft())
    expect(loadDraft(fakeStorage())).toEqual(exampleDraft())
    const storage = fakeStorage()
    storage.setItem(STORAGE_KEY, '{not json')
    expect(loadDraft(storage)).toEqual(exampleDraft())
    storage.setItem(STORAGE_KEY, JSON.stringify({ container: { l: 1 }, types: 'no' }))
    expect(loadDraft(storage)).toEqual(exampleDraft())
  })

  it('rejects drafts with a wrong shape', () => {
    expect(parseDraft('null')).toBeNull()
    expect(parseDraft('[]')).toBeNull()
    expect(parseDraft(JSON.stringify({ ...mixed(), unit: 'furlong' }))).toBeNull()
    expect(parseDraft(JSON.stringify({ ...mixed(), types: [{ id: 1 }] }))).toBeNull()
  })
})

describe('Store', () => {
  it('recomputes after an edit and persists the draft', () => {
    const storage = fakeStorage()
    const store = new Store(mixed(), storage, 0)
    const seen: boolean[] = []
    store.subscribe((s) => seen.push(s.derived.stale))
    // 26 pallet boxes exceed the container volume, so the recompute must report impossible.
    store.edit((d) => edits.stepQty(d, 'pallet', 20))
    expect(seen).toEqual([true, false])
    expect(store.get().derived.result?.status).toBe('impossible')
    expect(loadDraft(storage).types[0]?.qty).toBe('26')
  })

  it('marks the state stale until the debounced recompute runs', async () => {
    const store = new Store(mixed(), null, 5)
    store.edit((d) => edits.setContainer(d, 'l', '10'))
    expect(store.get().derived.stale).toBe(true)
    store.flush()
    expect(store.get().derived.stale).toBe(false)
    expect(store.get().derived.result?.status).toBe('impossible')
  })

  it('ignores edits that return the same draft', () => {
    const store = new Store(mixed(), null, 0)
    let calls = 0
    store.subscribe(() => calls++)
    store.edit((d) => d)
    expect(calls).toBe(0)
  })
})

describe('view state', () => {
  it('starts with defaults, patches without recompute, and survives edits', () => {
    const store = new Store(mixed(), null, 0)
    expect(store.get().view).toEqual({
      mode: '3d',
      layer: null,
      showContainer: true,
      hoverTypeId: null,
    })
    let notifications = 0
    store.subscribe(() => notifications++)
    store.setView({ layer: 48, hoverTypeId: 'pallet' })
    expect(notifications).toBe(1)
    expect(store.get().view).toMatchObject({ layer: 48, hoverTypeId: 'pallet', mode: '3d' })
    store.edit((d) => edits.stepQty(d, 'pallet', 1))
    expect(store.get().view.layer).toBe(48)
  })
})
