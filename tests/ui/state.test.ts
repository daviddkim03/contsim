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
      containerType: 'custom',
      container: { l: '', w: '-', h: '9'.repeat(30) },
      types: [
        {
          id: 'x',
          kind: 'custom',
          catalogCode: '',
          name: '',
          l: '.',
          w: '1',
          h: '1',
          qty: '-3',
          color: '#000',
        },
      ],
      keepUpright: true,
      unit: 'mm',
    }
    expect(() => derive(draft)).not.toThrow()
    expect(derive(draft).result).toBeNull()
  })
})

describe('container presets', () => {
  it('derives the container from the preset in the chosen unit', () => {
    const draft = edits.setContainerType(mixed(), '40ft-hc')
    expect(derive(draft).scenario?.container).toEqual({ l: 4737, w: 926, h: 1062 })
    expect(derive(draft).scale).toBe(10)
    const metric = edits.setUnit(draft, 'mm')
    expect(derive(metric).scenario?.container).toEqual({ l: 12032, w: 2352, h: 2698 })
    expect(derive(metric).scale).toBe(1)
  })

  it('keeps the custom dimensions while a preset is selected and prefills custom from the preset', () => {
    const custom = edits.setContainer(mixed(), 'l', '100')
    const preset = edits.setContainerType(custom, '20ft')
    expect(preset.container.l).toBe('100')
    expect(derive(preset).scenario?.container.l).toBe(2322)
    expect(edits.setContainerType(preset, '20ft')).toBe(preset)
    const back = edits.setContainerType(preset, 'custom')
    expect(back.container).toEqual({ l: '232.2', w: '92.6', h: '94.2' })
  })

  it('parses drafts saved before presets existed as custom and rejects unknown types', () => {
    const { containerType: _drop, ...legacy } = mixed()
    void _drop
    expect(parseDraft(JSON.stringify(legacy))?.containerType).toBe('custom')
    expect(parseDraft(JSON.stringify({ ...mixed(), containerType: '60ft' }))).toBeNull()
    expect(parseDraft(JSON.stringify({ ...mixed(), containerType: '40ft' }))?.containerType).toBe(
      '40ft',
    )
  })
})

describe('catalog rows', () => {
  it('a new row waits for a catalog pick and reports only that', () => {
    const draft = edits.addType(mixed())
    const added = draft.types[5]!
    expect(added).toMatchObject({ kind: 'catalog', catalogCode: '', name: '', qty: '1' })
    const d = derive(draft)
    expect(d.issues).toEqual({ 'types[5].catalog': 'Pick a cabinet from the catalog' })
    expect(d.result).toBeNull()
  })

  it('takes name and size from the catalog in the chosen unit', () => {
    let draft = edits.addType(mixed())
    const id = draft.types[5]!.id
    draft = edits.setCatalogItem(draft, id, '3036')
    expect(draft.types[5]).toMatchObject({
      kind: 'catalog',
      catalogCode: '3036',
      name: '3036',
      l: '30',
      w: '12',
      h: '36',
    })
    let d = derive(draft)
    expect(d.issues).toEqual({})
    expect(d.scenario?.types[5]).toMatchObject({ name: '3036', dims: { l: 30, w: 12, h: 36 } })

    d = derive(edits.setUnit(draft, 'mm'))
    expect(d.scale).toBe(10)
    expect(d.scenario?.types[5]?.dims).toEqual({ l: 7620, w: 3048, h: 9144 })
  })

  it('flags a code that is not in the catalog', () => {
    let draft = edits.addType(mixed())
    draft = edits.setCatalogItem(draft, draft.types[5]!.id, 'XX99')
    expect(derive(draft).issues).toEqual({ 'types[5].catalog': 'Not in the catalog' })
  })

  it('switches to a custom box, keeping the picked size as a starting point', () => {
    let draft = edits.addType(mixed())
    const id = draft.types[5]!.id
    draft = edits.setCatalogItem(draft, id, '3036')
    draft = edits.setCustom(draft, id, '  Special ')
    expect(draft.types[5]).toMatchObject({ kind: 'custom', name: 'Special', l: '30', w: '12' })
    expect(derive(draft).scenario?.types[5]?.name).toBe('Special')
    const fresh = edits.addType(mixed())
    const unnamed = edits.setCustom(fresh, fresh.types[5]!.id, '')
    expect(unnamed.types[5]?.name).toBe('Box A')
  })

  it('parses rows saved before the catalog as custom and rejects bad kinds', () => {
    const legacy = mixed().types.map(({ kind: _k, catalogCode: _c, ...rest }) => {
      void _k
      void _c
      return rest
    })
    const parsed = parseDraft(JSON.stringify({ ...mixed(), types: legacy }))
    expect(parsed?.types[0]).toMatchObject({ kind: 'custom', catalogCode: '' })
    const bad = { ...mixed(), types: [{ ...mixed().types[0], kind: 'magic' }] }
    expect(parseDraft(JSON.stringify(bad))).toBeNull()
  })
})

describe('edits', () => {
  it('addType appends a box with a fresh id and color', () => {
    const draft = edits.addType(mixed())
    const added = draft.types[5]!
    expect(draft.types).toHaveLength(6)
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

describe('optimize state', () => {
  it('starts idle, accepts patches, and resets on any edit except the objective', () => {
    const store = new Store(mixed(), null, 0)
    expect(store.get().optimize.status).toBe('idle')
    store.setOptimize({ objective: 'cut-evenly', status: 'running', runs: 3, maxRuns: 200 })
    expect(store.get().optimize).toMatchObject({ status: 'running', runs: 3 })
    store.edit((d) => edits.stepQty(d, 'pallet', 1))
    expect(store.get().optimize).toMatchObject({ status: 'idle', runs: 0, objective: 'cut-evenly' })
  })
})
