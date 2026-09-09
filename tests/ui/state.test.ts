import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZE,
  Store,
  STORAGE_KEY,
  allocationOf,
  derive,
  draftFromScenario,
  edits,
  exampleDraft,
  loadDraft,
  parseDraft,
  saveDraft,
  shownContainer,
  shownResult,
  type Draft,
} from '../../src/ui/state'
import { mixedScenario } from '../../src/scenarios'
import { packMany } from '../../src/core'

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
      mode: 'even',
      allocation: null,
      maxWeight: '',
      weightUnit: 'kg',
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
          weight: 'x',
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
    // 12,032 mm at a scale of 10, because the boxes now have a decimal (48 in = 1219.2 mm).
    expect(derive(metric).scale).toBe(10)
    expect(derive(metric).scenario?.container).toEqual({ l: 120320, w: 23520, h: 26980 })
  })

  it('converts every typed size when the unit changes, and takes catalog sizes from the catalog', () => {
    const draft = edits.setUnit(mixed(), 'mm')
    // Custom boxes: 48 x 40 x 48 in.
    expect(draft.types[0]).toMatchObject({ kind: 'custom', l: '1219.2', w: '1016', h: '1219.2' })
    // The custom container size travels with the unit even while a preset is selected.
    expect(draft.container).toEqual({ l: '5892.8', w: '2336.8', h: '2387.6' })
    expect(edits.setUnit(draft, 'in').types[0]).toMatchObject({ l: '48', w: '40', h: '48' })
    // Selecting the unit that is already set changes nothing.
    const unchanged = mixed()
    expect(edits.setUnit(unchanged, 'in')).toBe(unchanged)

    let fromCatalog = edits.addType(mixed())
    const id = fromCatalog.types.at(-1)!.id
    fromCatalog = edits.setCatalogItem(fromCatalog, id, '3036')
    expect(edits.setUnit(fromCatalog, 'mm').types.at(-1)).toMatchObject({
      l: '762',
      w: '304.8',
      h: '914.4',
    })
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

  it('applyImport replaces the rows and applies container settings when the file has them', () => {
    const draft = mixed()
    const types = [{ ...draft.types[0]!, id: 'new', qty: '7' }]
    const plain = edits.applyImport(draft, { types, unit: 'in', weightUnit: 'kg', container: null })
    expect(plain.types).toBe(types)
    expect(plain).toMatchObject({ unit: 'in', containerType: 'custom', keepUpright: false })

    // Without container settings the file's unit still applies, so the container converts.
    const metric = edits.applyImport(draft, {
      types,
      unit: 'mm',
      weightUnit: 'kg',
      container: null,
    })
    expect(metric).toMatchObject({ unit: 'mm', containerType: 'custom' })
    expect(metric.container).toEqual({ l: '5892.8', w: '2336.8', h: '2387.6' })

    const preset = edits.applyImport(draft, {
      types,
      unit: 'mm',
      weightUnit: 'kg',
      container: {
        containerType: '40ft',
        container: null,
        maxWeight: '',
        keepUpright: true,
        mode: 'optimize',
      },
    })
    expect(preset).toMatchObject({
      containerType: '40ft',
      unit: 'mm',
      keepUpright: true,
      mode: 'optimize',
    })

    const custom = edits.applyImport(draft, {
      types,
      unit: 'cm',
      weightUnit: 'lb',
      container: {
        containerType: 'custom',
        container: { l: '1', w: '2', h: '3' },
        maxWeight: '4000',
        keepUpright: false,
        mode: 'even',
      },
    })
    expect(custom.container).toEqual({ l: '1', w: '2', h: '3' })
    expect(custom).toMatchObject({ unit: 'cm', weightUnit: 'lb', maxWeight: '4000' })
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

describe('hand-placed counts', () => {
  it('are used for the packing and can be reset', () => {
    const store = new Store(exampleDraft(), null, 0)
    const inFirst = (id: string) =>
      store.get().derived.result!.containers[0]!.placements.filter((p) => p.typeId === id).length
    expect(inFirst('18')).toBe(14)

    store.edit((d) => edits.setContainerCount(d, 0, '18', 4))
    expect(allocationOf(store.get().draft)).toEqual([{ '18': 4 }])
    expect(inFirst('18')).toBe(4)

    store.edit(edits.clearAllocation)
    expect(store.get().draft.allocation).toBeNull()
    expect(inFirst('18')).toBe(14)
  })

  it('survive a quantity change but not a change of scenario', () => {
    const pinned = edits.setContainerCount(exampleDraft(), 1, '36', 3)
    expect(allocationOf(pinned)).toEqual([{}, { '36': 3 }])
    expect(allocationOf(edits.setTypeField(pinned, '18', 'qty', '2'))).toEqual([{}, { '36': 3 }])
    // A different container, mode, unit or box size makes them meaningless.
    expect(allocationOf(edits.setContainerType(pinned, '40ft'))).toBeUndefined()
    expect(allocationOf(edits.setMode(pinned, 'optimize'))).toBeUndefined()
    expect(allocationOf(edits.setUnit(pinned, 'mm'))).toBeUndefined()
    expect(allocationOf(edits.setKeepUpright(pinned, true))).toBeUndefined()
    expect(allocationOf(edits.removeType(pinned, '18'))).toBeUndefined()
    expect(allocationOf(edits.setCustom(pinned, '18', 'Crate'))).toBeUndefined()
    // Still there, so the app can tell a stale split from none at all.
    expect(edits.setContainerType(pinned, '40ft').allocation).not.toBeNull()
  })

  it('are whole and never negative', () => {
    const draft = edits.setContainerCount(
      edits.setContainerCount(exampleDraft(), 0, '18', -5),
      2,
      '36',
      2.6,
    )
    expect(allocationOf(draft)).toEqual([{ '18': 0 }, {}, { '36': 3 }])
  })
})

describe('persistence', () => {
  it('keeps hand-placed counts, and rejects broken ones', () => {
    const pinned = edits.setContainerCount(mixed(), 0, 'pallet', 2)
    expect(parseDraft(JSON.stringify(pinned))?.allocation).toEqual(pinned.allocation)
    const { allocation: _drop, ...legacy } = mixed()
    void _drop
    expect(parseDraft(JSON.stringify(legacy))?.allocation).toBeNull()
    for (const bad of [
      { shape: 1, counts: [] },
      { shape: 'x' },
      { shape: 'x', counts: [{ a: -1 }] },
      { shape: 'x', counts: [{ a: 1.5 }] },
      { shape: 'x', counts: [null] },
    ]) {
      expect(parseDraft(JSON.stringify({ ...mixed(), allocation: bad }))).toBeNull()
    }
  })

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
    // 26 pallet boxes exceed one container, so the recompute must open another.
    store.edit((d) => edits.stepQty(d, 'pallet', 20))
    expect(seen).toEqual([true, false])
    expect(store.get().derived.result?.status).toBe('fits')
    expect(store.get().derived.result?.containers.length).toBeGreaterThan(1)
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
      container: 0,
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
  it('starts idle, accepts patches, and resets on any edit', () => {
    const store = new Store(mixed(), null, 0)
    expect(store.get().optimize.status).toBe('idle')
    store.setOptimize({ status: 'running', runs: 3, maxRuns: 400, containers: 1 })
    expect(store.get().optimize).toMatchObject({ status: 'running', runs: 3, containers: 1 })
    store.edit((d) => edits.stepQty(d, 'pallet', 1))
    expect(store.get().optimize).toEqual(DEFAULT_OPTIMIZE)
  })
})

describe('shownResult and shownContainer', () => {
  const overflow = () => edits.stepQty(mixed(), 'pallet', 20)

  it('shows first fit until the optimizer is in, then the better of the two', () => {
    const store = new Store(overflow(), null, 0)
    const quick = store.get().derived.result!
    expect(shownResult(store.get())).toBe(quick)
    const scenario = store.get().derived.scenario!
    const optimized = packMany(scenario.container, scenario.types, {
      keepUpright: false,
      optimizeRuns: 200,
    })
    store.setOptimize({ status: 'done', result: optimized })
    expect(shownResult(store.get())).toBe(optimized)

    // A result that needs more containers is never shown.
    const worse = { ...optimized, containers: [...optimized.containers, optimized.containers[0]!] }
    store.setOptimize({ status: 'done', result: worse })
    expect(shownResult(store.get())).toBe(quick)
  })

  it('clamps the selected container to what exists', () => {
    const store = new Store(overflow(), null, 0)
    const n = store.get().derived.result!.containers.length
    expect(n).toBeGreaterThan(1)
    expect(shownContainer(store.get())).toMatchObject({ index: 0 })
    store.setView({ container: 1 })
    expect(shownContainer(store.get()).packing).toBe(store.get().derived.result!.containers[1])
    store.setView({ container: 99 })
    expect(shownContainer(store.get()).index).toBe(n - 1)
    store.setView({ container: -5 })
    expect(shownContainer(store.get()).index).toBe(0)
    store.edit((d) => edits.setContainer(d, 'l', '10'))
    expect(shownContainer(store.get())).toEqual({ index: 0, packing: null })
  })
})
