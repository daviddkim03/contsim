import {
  packMany,
  validateScenario,
  type BoxType,
  type Container,
  type LoadMode,
  type MultiPackResult,
  type PackResult,
  type Scenario,
} from '../core'
import { catalogTexts, catalogWeightText } from './catalogSearch'
import { findCatalogItem } from './catalogStore'
import { exampleDraft } from './example'
import { nextColor } from './palette'
import {
  CONTAINER_TYPES,
  presetFor,
  presetPayloadText,
  presetTexts,
  type ContainerType,
} from './presets'
import {
  UNITS,
  WEIGHT_UNITS,
  convertLength,
  convertWeight,
  parseCount,
  parseLength,
  scaleFor,
  toGrams,
  toInt,
  type Unit,
  type WeightUnit,
} from './units'

export type BoxKind = 'catalog' | 'custom'

/** What the user typed. Strings, so partial or invalid input survives a render and can be flagged. */
export interface BoxTypeDraft {
  id: string
  /** Catalog rows take their name and size from the catalog code; custom rows from the fields. */
  kind: BoxKind
  /** Empty until a catalog item is picked. */
  catalogCode: string
  name: string
  l: string
  w: string
  h: string
  /** Weight of one box in the draft's weight unit; blank means unknown. */
  weight: string
  qty: string
  color: string
}

export const BOX_KINDS: readonly BoxKind[] = ['catalog', 'custom']
export const LOAD_MODES: readonly LoadMode[] = ['even', 'optimize']

/**
 * Box counts the user moved between containers by hand, kept only for the
 * scenario they were set for: change a container, a box size, the mode or the
 * unit and the packing is a different one, so the counts are dropped.
 */
export interface Allocation {
  shape: string
  /** Pinned counts by container index, then type id. */
  counts: Record<string, number>[]
}

/** What an imported spreadsheet contributes: box rows, and container settings when the file has them. */
export interface ScenarioImport {
  types: BoxTypeDraft[]
  /** The unit the sizes above are in; it becomes the app's unit. */
  unit: Unit
  /** The unit the weights above are in; it becomes the app's weight unit. */
  weightUnit: WeightUnit
  container: {
    containerType: ContainerType
    /** Custom interior size in `unit`; null when the file names a preset. */
    container: { l: string; w: string; h: string } | null
    /** What a custom container may carry, in `weightUnit`; blank for no limit. */
    maxWeight: string
    keepUpright: boolean
    mode: LoadMode
  } | null
}

export interface Draft {
  /** A standard container, or 'custom' to use the typed dimensions below. */
  containerType: ContainerType
  /** How the boxes are spread over the containers. */
  mode: LoadMode
  /** Hand-placed box counts, or null while the split is left to the mode. */
  allocation: Allocation | null
  /** Custom interior dimensions. Kept while a preset is selected, so switching back restores them. */
  container: { l: string; w: string; h: string }
  /** What a custom container may carry, in `weightUnit`; blank means no limit. */
  maxWeight: string
  types: BoxTypeDraft[]
  keepUpright: boolean
  unit: Unit
  weightUnit: WeightUnit
}

/**
 * What the packing depends on, apart from the quantities. Hand-placed counts
 * only make sense for one of these, so they travel with it.
 */
export function scenarioShape(draft: Draft): string {
  const c = containerTexts(draft)
  return JSON.stringify([
    c.l,
    c.w,
    c.h,
    draft.unit,
    draft.mode,
    draft.keepUpright,
    payloadText(draft),
    draft.weightUnit,
    draft.types.map((t) => [t.id, t.kind, t.catalogCode, t.l, t.w, t.h, t.weight]),
  ])
}

/** The counts to pack with: the hand-placed ones, if they are still for this scenario. */
export function allocationOf(draft: Draft): Record<string, number>[] | undefined {
  const a = draft.allocation
  return a && a.shape === scenarioShape(draft) ? a.counts : undefined
}

/** The container dimensions the draft stands for: the preset's, or the typed ones. */
export function containerTexts(draft: Draft): { l: string; w: string; h: string } {
  const preset = presetFor(draft.containerType)
  return preset ? presetTexts(preset, draft.unit) : draft.container
}

/** What the container may carry: the preset's payload, or the typed one. */
export function payloadText(draft: Draft): string {
  const preset = presetFor(draft.containerType)
  return preset ? presetPayloadText(preset, draft.weightUnit) : draft.maxWeight
}

/** Everything computed from the draft. */
export interface Derived {
  scale: number
  /** Field path (e.g. "types[1].dims.h") to message. Empty when the draft is valid. */
  issues: Record<string, string>
  scenario: Scenario | null
  /** First-fit packing into as many containers as needed. The optimizer may improve on it later. */
  result: MultiPackResult | null
  /** True while a recompute is pending after an edit. */
  stale: boolean
}

/** Transient view settings. Not persisted, never trigger a recompute. */
export interface ViewState {
  mode: '3d' | 'table'
  /** Boxes whose bottom is above this height (core units) are hidden. null shows everything. */
  layer: number | null
  showContainer: boolean
  /** Box type highlighted from the legend or the sidebar. */
  hoverTypeId: string | null
  /** Index of the container shown in 3D. Clamped to what exists when read. */
  container: number
}

export const DEFAULT_VIEW: ViewState = {
  mode: '3d',
  layer: null,
  showContainer: true,
  hoverTypeId: null,
  container: 0,
}

/** Background optimizer state. Any edit of the draft resets it to idle. */
export interface OptimizeUiState {
  status: 'idle' | 'running' | 'done' | 'failed'
  runs: number
  maxRuns: number
  /** Containers the optimizer has finished so far. */
  containers: number
  result: MultiPackResult | null
  error: string | null
}

export const DEFAULT_OPTIMIZE: OptimizeUiState = {
  status: 'idle',
  runs: 0,
  maxRuns: 0,
  containers: 0,
  result: null,
  error: null,
}

export interface AppState {
  draft: Draft
  derived: Derived
  view: ViewState
  optimize: OptimizeUiState
}

/** Fewer containers wins; with the same count, more boxes placed wins. */
function worse(a: MultiPackResult, b: MultiPackResult): boolean {
  return (
    a.containers.length > b.containers.length ||
    (a.containers.length === b.containers.length && a.stats.placed < b.stats.placed)
  )
}

/** The packing to display: the optimizer's once it is in and not worse, otherwise first fit. */
export function shownResult(state: AppState): MultiPackResult | null {
  const quick = state.derived.result
  const o = state.optimize
  if (o.status === 'done' && o.result && quick && !worse(o.result, quick)) return o.result
  return quick
}

/** The container selected for the 3D view, with its index clamped to what exists. */
export function shownContainer(state: AppState): { index: number; packing: PackResult | null } {
  const result = shownResult(state)
  const n = result?.containers.length ?? 0
  const index = n === 0 ? 0 : Math.min(Math.max(0, state.view.container), n - 1)
  return { index, packing: result?.containers[index] ?? null }
}

// ---------------------------------------------------------------------------
// Draft <-> scenario

export function draftFromScenario(scenario: Scenario, unit: Unit): Draft {
  const s = (n: number) => String(n)
  return {
    containerType: 'custom',
    mode: 'even',
    allocation: null,
    container: {
      l: s(scenario.container.l),
      w: s(scenario.container.w),
      h: s(scenario.container.h),
    },
    maxWeight: '',
    weightUnit: 'kg',
    keepUpright: scenario.keepUpright,
    unit,
    types: scenario.types.map((t) => ({
      id: t.id,
      kind: 'custom' as const,
      catalogCode: '',
      name: t.name,
      l: s(t.dims.l),
      w: s(t.dims.w),
      h: s(t.dims.h),
      weight: t.weight ? s(t.weight / 1000) : '',
      qty: s(t.qty),
      color: t.color,
    })),
  }
}

export { exampleDraft } from './example'

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const NO_DIMS = { l: NaN, w: NaN, h: NaN }

/** Parses, scales, validates and packs the draft. Pure and synchronous; a few milliseconds. */
export function derive(draft: Draft): Derived {
  const issues: Record<string, string> = {}
  const containerText = containerTexts(draft)
  // A catalog row's size comes from the catalog in the draft's unit; a custom row's from its fields.
  const rows = draft.types.map((t) => {
    const item = t.kind === 'catalog' ? findCatalogItem(t.catalogCode) : null
    return { item, texts: item ? catalogTexts(item, draft.unit) : { l: t.l, w: t.w, h: t.h } }
  })
  const texts = [
    containerText.l,
    containerText.w,
    containerText.h,
    ...rows.flatMap((r) => [r.texts.l, r.texts.w, r.texts.h]),
  ]
  const scale = scaleFor(texts)

  const length = (path: string, text: string): number => {
    const v = parseLength(text)
    if (v === null) {
      issues[path] = 'Enter a number'
      return NaN
    }
    return toInt(v, scale)
  }
  const count = (path: string, text: string): number => {
    const v = parseCount(text)
    if (v === null) {
      issues[path] = 'Enter a whole number'
      return NaN
    }
    return v
  }

  const container: Container = {
    l: length('container.l', containerText.l),
    w: length('container.w', containerText.w),
    h: length('container.h', containerText.h),
  }
  /** Blank is "not known", which the packer treats as no weight and no limit. */
  const grams = (path: string, text: string): number => {
    if (text.trim() === '') return 0
    const v = parseLength(text)
    if (v === null) {
      issues[path] = 'Enter a number'
      return 0
    }
    return toGrams(v, draft.weightUnit)
  }
  const maxWeight = grams('container.maxWeight', payloadText(draft))
  const unresolved = new Set<number>()
  const types: BoxType[] = draft.types.map((t, i) => {
    const { item, texts } = rows[i]!
    const qty = count(`types[${i}].qty`, t.qty)
    if (t.kind === 'catalog' && !item) {
      issues[`types[${i}].catalog`] = t.catalogCode
        ? 'Not in the catalog'
        : 'Pick a cabinet from the catalog'
      unresolved.add(i)
      return {
        id: t.id,
        name: t.name.trim() || `Box ${i + 1}`,
        color: t.color,
        dims: NO_DIMS,
        weight: 0,
        qty,
      }
    }
    return {
      id: t.id,
      name: item ? item.code : t.name.trim() || `Box ${i + 1}`,
      color: t.color,
      dims: {
        l: length(`types[${i}].dims.l`, texts.l),
        w: length(`types[${i}].dims.w`, texts.w),
        h: length(`types[${i}].dims.h`, texts.h),
      },
      weight: grams(`types[${i}].weight`, t.weight),
      qty,
    }
  })

  for (const issue of validateScenario(container, types)) {
    // A row still waiting for a catalog pick has no dimensions to complain about.
    const row = /^types\[(\d+)\]\.dims\./.exec(issue.path)
    if (row && unresolved.has(Number(row[1]))) continue
    if (!(issue.path in issues)) issues[issue.path] = capitalize(issue.message)
  }
  if (Object.keys(issues).length > 0) {
    return { scale, issues, scenario: null, result: null, stale: false }
  }

  const scenario: Scenario = { container, types, keepUpright: draft.keepUpright }
  // In 'even' mode this is the finished answer; in 'optimize' mode it is first
  // fit, which the worker then improves on (src/ui/optimizeClient.ts).
  const result = packMany(container, types, {
    keepUpright: draft.keepUpright,
    mode: draft.mode,
    maxWeight,
    allocation: allocationOf(draft),
  })
  return { scale, issues, scenario, result, stale: false }
}

// ---------------------------------------------------------------------------
// Draft edits. Each returns a new draft and leaves the input untouched.

export type ContainerKey = 'l' | 'w' | 'h'
export type TypeField = 'name' | 'l' | 'w' | 'h' | 'weight' | 'qty'

export function newTypeId(existing: readonly string[]): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 10)
    if (!existing.includes(id)) return id
  }
}

function newTypeName(types: readonly BoxTypeDraft[]): string {
  const used = new Set(types.map((t) => t.name.trim()))
  for (let i = 0; ; i++) {
    const name = `Box ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`
    if (!used.has(name)) return name
  }
}

export const edits = {
  setContainer(draft: Draft, key: ContainerKey, value: string): Draft {
    return { ...draft, container: { ...draft.container, [key]: value } }
  },
  /** Switching from a preset to custom starts from the preset's dimensions. */
  setContainerType(draft: Draft, containerType: ContainerType): Draft {
    if (containerType === draft.containerType) return draft
    const container = containerType === 'custom' ? containerTexts(draft) : draft.container
    return { ...draft, containerType, container }
  },
  /**
   * Switches the display unit. Every size is a real measurement, so typed
   * numbers convert; catalog rows are recomputed from the catalog, which is
   * exact.
   */
  setMode(draft: Draft, mode: LoadMode): Draft {
    return mode === draft.mode ? draft : { ...draft, mode }
  },
  /**
   * Puts `count` boxes of a type in one container. The rest of them move to
   * the containers after it, and the packer still only takes what fits, so
   * asking for more than a container can hold quietly stops at its capacity.
   */
  setContainerCount(draft: Draft, container: number, typeId: string, count: number): Draft {
    const shape = scenarioShape(draft)
    const counts =
      draft.allocation?.shape === shape ? draft.allocation.counts.map((c) => ({ ...c })) : []
    while (counts.length <= container) counts.push({})
    counts[container]![typeId] = Math.max(0, Math.round(count))
    return { ...draft, allocation: { shape, counts } }
  },
  /** Hands the split back to the loading mode. */
  clearAllocation(draft: Draft): Draft {
    return draft.allocation === null ? draft : { ...draft, allocation: null }
  },
  setMaxWeight(draft: Draft, maxWeight: string): Draft {
    return { ...draft, maxWeight }
  },
  /** Switching the weight unit converts every weight, like the length unit does. */
  setWeightUnit(draft: Draft, weightUnit: WeightUnit): Draft {
    if (weightUnit === draft.weightUnit) return draft
    const convert = (text: string): string => {
      const value = parseLength(text)
      return value === null ? text : String(convertWeight(value, draft.weightUnit, weightUnit))
    }
    return {
      ...draft,
      weightUnit,
      maxWeight: convert(draft.maxWeight),
      types: draft.types.map((t) => ({ ...t, weight: convert(t.weight) })),
    }
  },
  setUnit(draft: Draft, unit: Unit): Draft {
    if (unit === draft.unit) return draft
    const convert = (text: string): string => {
      const value = parseLength(text)
      return value === null ? text : String(convertLength(value, draft.unit, unit))
    }
    return {
      ...draft,
      unit,
      container: {
        l: convert(draft.container.l),
        w: convert(draft.container.w),
        h: convert(draft.container.h),
      },
      types: draft.types.map((t) => {
        const item = t.kind === 'catalog' ? findCatalogItem(t.catalogCode) : null
        if (item) return { ...t, ...catalogTexts(item, unit) }
        return { ...t, l: convert(t.l), w: convert(t.w), h: convert(t.h) }
      }),
    }
  },
  setKeepUpright(draft: Draft, keepUpright: boolean): Draft {
    return { ...draft, keepUpright }
  },
  /** A new row starts as a catalog search with nothing picked yet. */
  addType(draft: Draft): Draft {
    const type: BoxTypeDraft = {
      id: newTypeId(draft.types.map((t) => t.id)),
      kind: 'catalog',
      catalogCode: '',
      name: '',
      l: '',
      w: '',
      h: '',
      weight: '',
      qty: '1',
      color: nextColor(draft.types.map((t) => t.color)),
    }
    return { ...draft, types: [...draft.types, type] }
  },
  /** Picks a catalog item; its size is also copied into the fields so a later switch to custom starts from it. */
  setCatalogItem(draft: Draft, id: string, code: string): Draft {
    const item = findCatalogItem(code)
    const texts = item ? catalogTexts(item, draft.unit) : null
    // A catalog weight fills the field; without one the row keeps what it had.
    const weight = item ? catalogWeightText(item, draft.weightUnit) : ''
    return {
      ...draft,
      types: draft.types.map((t) =>
        t.id === id
          ? {
              ...t,
              kind: 'catalog',
              catalogCode: code,
              name: code,
              ...texts,
              weight: weight || t.weight,
            }
          : t,
      ),
    }
  },
  /** Turns every row that uses `code` back into a custom box, keeping the size it had. */
  unsetCatalogItem(draft: Draft, code: string): Draft {
    return {
      ...draft,
      types: draft.types.map((t) =>
        t.kind === 'catalog' && t.catalogCode === code
          ? { ...t, kind: 'custom', catalogCode: '', name: t.name.trim() || code }
          : t,
      ),
    }
  },
  /** Turns a row into a custom box named `name` (or a generated name), keeping whatever size it had. */
  setCustom(draft: Draft, id: string, name: string): Draft {
    const others = draft.types.filter((t) => t.id !== id)
    const finalName = name.trim() || newTypeName(others)
    return {
      ...draft,
      types: draft.types.map((t) => (t.id === id ? { ...t, kind: 'custom', name: finalName } : t)),
    }
  },
  removeType(draft: Draft, id: string): Draft {
    return { ...draft, types: draft.types.filter((t) => t.id !== id) }
  },
  /** Empties the box list, keeping the container and the settings. */
  clearTypes(draft: Draft): Draft {
    return draft.types.length === 0 ? draft : { ...draft, types: [], allocation: null }
  },
  setTypeField(draft: Draft, id: string, field: TypeField, value: string): Draft {
    return {
      ...draft,
      types: draft.types.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
    }
  },
  stepQty(draft: Draft, id: string, delta: number): Draft {
    return {
      ...draft,
      types: draft.types.map((t) => {
        if (t.id !== id) return t
        const current = parseCount(t.qty) ?? 0
        return { ...t, qty: String(Math.max(0, current + delta)) }
      }),
    }
  },
  /**
   * Replaces the box list with an import and switches to the file's unit
   * (which converts the container the import does not carry).
   */
  applyImport(draft: Draft, imported: ScenarioImport): Draft {
    const converted = edits.setWeightUnit(edits.setUnit(draft, imported.unit), imported.weightUnit)
    const c = imported.container
    return {
      ...converted,
      types: imported.types,
      ...(c
        ? {
            containerType: c.containerType,
            container: c.container ?? converted.container,
            maxWeight: c.maxWeight || converted.maxWeight,
            keepUpright: c.keepUpright,
            mode: c.mode,
          }
        : {}),
    }
  },
  setQuantities(draft: Draft, qty: Record<string, number>): Draft {
    return {
      ...draft,
      types: draft.types.map((t) => (t.id in qty ? { ...t, qty: String(qty[t.id]) } : t)),
    }
  },
}

// ---------------------------------------------------------------------------
// Persistence

export const STORAGE_KEY = 'contsim.draft.v1'

export function serializeDraft(draft: Draft): string {
  return JSON.stringify(draft, null, 2)
}

const isString = (v: unknown): v is string => typeof v === 'string'

/** null when there is nothing saved, undefined when what is saved is not an allocation. */
function parseAllocation(value: unknown): Allocation | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object') return undefined
  const a = value as Record<string, unknown>
  if (!isString(a.shape) || !Array.isArray(a.counts)) return undefined
  const counts: Record<string, number>[] = []
  for (const entry of a.counts) {
    if (!entry || typeof entry !== 'object') return undefined
    const one: Record<string, number> = {}
    for (const [id, n] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return undefined
      one[id] = n
    }
    counts.push(one)
  }
  return { shape: a.shape, counts }
}

/** Reads a draft back from JSON, rejecting anything that does not have the expected shape. */
export function parseDraft(json: string): Draft | null {
  try {
    const raw: unknown = JSON.parse(json)
    if (!raw || typeof raw !== 'object') return null
    const d = raw as Record<string, unknown>
    const c = d.container as Record<string, unknown> | undefined
    if (!c || !isString(c.l) || !isString(c.w) || !isString(c.h)) return null
    // Drafts saved before weights existed have none, which means unknown.
    const maxWeight = d.maxWeight === undefined ? '' : d.maxWeight
    if (!isString(maxWeight)) return null
    const weightUnit = d.weightUnit === undefined ? 'kg' : d.weightUnit
    if (!WEIGHT_UNITS.includes(weightUnit as WeightUnit)) return null
    if (!Array.isArray(d.types)) return null
    if (!UNITS.includes(d.unit as Unit)) return null
    // Drafts saved before container presets existed have no type: they are custom.
    const containerType = d.containerType === undefined ? 'custom' : d.containerType
    if (!CONTAINER_TYPES.includes(containerType as ContainerType)) return null
    // Drafts saved before the modes existed get the default, like a new one.
    const mode = d.mode === undefined ? 'even' : d.mode
    if (!LOAD_MODES.includes(mode as LoadMode)) return null
    const allocation = parseAllocation(d.allocation)
    if (allocation === undefined) return null
    const types: BoxTypeDraft[] = []
    for (const t of d.types as unknown[]) {
      const r = t as Record<string, unknown>
      if (!r || !isString(r.id) || !isString(r.name) || !isString(r.color)) return null
      if (!isString(r.l) || !isString(r.w) || !isString(r.h) || !isString(r.qty)) return null
      const weight = r.weight === undefined ? '' : r.weight
      if (!isString(weight)) return null
      // Rows saved before the catalog existed are custom boxes.
      const kind = r.kind === undefined ? 'custom' : r.kind
      if (!BOX_KINDS.includes(kind as BoxKind)) return null
      const catalogCode = r.catalogCode === undefined ? '' : r.catalogCode
      if (!isString(catalogCode)) return null
      types.push({
        id: r.id,
        kind: kind as BoxKind,
        catalogCode,
        name: r.name,
        l: r.l,
        w: r.w,
        h: r.h,
        weight,
        qty: r.qty,
        color: r.color,
      })
    }
    return {
      containerType: containerType as ContainerType,
      mode: mode as LoadMode,
      allocation,
      container: { l: c.l, w: c.w, h: c.h },
      maxWeight,
      types,
      keepUpright: d.keepUpright === true,
      unit: d.unit as Unit,
      weightUnit: weightUnit as WeightUnit,
    }
  } catch {
    return null
  }
}

export function loadDraft(storage: Storage | null): Draft {
  try {
    const json = storage?.getItem(STORAGE_KEY)
    const draft = json ? parseDraft(json) : null
    if (draft) return draft
  } catch {
    // Storage can be unavailable (private mode, disabled cookies). Fall through.
  }
  return exampleDraft()
}

export function saveDraft(storage: Storage | null, draft: Draft): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Quota or availability problems are not worth interrupting the user for.
  }
}

// ---------------------------------------------------------------------------
// Store

export type Listener = (state: AppState) => void

export class Store {
  private state: AppState
  private readonly listeners = new Set<Listener>()
  private readonly storage: Storage | null
  private readonly debounceMs: number
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(draft: Draft, storage: Storage | null = null, debounceMs = 150) {
    this.storage = storage
    this.debounceMs = debounceMs
    this.state = { draft, derived: derive(draft), view: DEFAULT_VIEW, optimize: DEFAULT_OPTIMIZE }
  }

  get(): AppState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Applies an edit, persists it, notifies listeners, and schedules a recompute. */
  edit(fn: (draft: Draft) => Draft): void {
    const draft = fn(this.state.draft)
    if (draft === this.state.draft) return
    this.state = {
      ...this.state,
      draft,
      derived: { ...this.state.derived, stale: true },
      optimize: DEFAULT_OPTIMIZE,
    }
    saveDraft(this.storage, draft)
    this.emit()
    this.schedule()
  }

  /** Changes view settings only; listeners are notified, nothing is persisted or recomputed. */
  setView(patch: Partial<ViewState>): void {
    this.state = { ...this.state, view: { ...this.state.view, ...patch } }
    this.emit()
  }

  /** Updates optimizer state; listeners are notified, nothing is persisted or recomputed. */
  setOptimize(patch: Partial<OptimizeUiState>): void {
    this.state = { ...this.state, optimize: { ...this.state.optimize, ...patch } }
    this.emit()
  }

  /** Runs any pending recompute now. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.state.derived.stale) this.recompute()
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.debounceMs === 0) {
      this.recompute()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.recompute()
    }, this.debounceMs)
  }

  private recompute(): void {
    this.state = { ...this.state, derived: derive(this.state.draft) }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state)
  }
}
