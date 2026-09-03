import {
  packMany,
  validateScenario,
  type BoxType,
  type Container,
  type MultiPackResult,
  type PackResult,
  type Scenario,
} from '../core'
import { catalogTexts, findCatalogItem } from './catalogSearch'
import { exampleDraft } from './example'
import { nextColor } from './palette'
import { CONTAINER_TYPES, presetFor, presetTexts, type ContainerType } from './presets'
import { UNITS, parseCount, parseLength, scaleFor, toInt, type Unit } from './units'

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
  qty: string
  color: string
}

export const BOX_KINDS: readonly BoxKind[] = ['catalog', 'custom']

/** What an imported spreadsheet contributes: box rows, and container settings when the file has them. */
export interface ScenarioImport {
  types: BoxTypeDraft[]
  container: {
    containerType: ContainerType
    /** Custom interior size in `unit`; null when the file names a preset. */
    container: { l: string; w: string; h: string } | null
    unit: Unit
    keepUpright: boolean
  } | null
}

export interface Draft {
  /** A standard container, or 'custom' to use the typed dimensions below. */
  containerType: ContainerType
  /** Custom interior dimensions. Kept while a preset is selected, so switching back restores them. */
  container: { l: string; w: string; h: string }
  types: BoxTypeDraft[]
  keepUpright: boolean
  unit: Unit
}

/** The container dimensions the draft stands for: the preset's, or the typed ones. */
export function containerTexts(draft: Draft): { l: string; w: string; h: string } {
  const preset = presetFor(draft.containerType)
  return preset ? presetTexts(preset, draft.unit) : draft.container
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
    container: {
      l: s(scenario.container.l),
      w: s(scenario.container.w),
      h: s(scenario.container.h),
    },
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
  const unresolved = new Set<number>()
  const types: BoxType[] = draft.types.map((t, i) => {
    const { item, texts } = rows[i]!
    const qty = count(`types[${i}].qty`, t.qty)
    if (t.kind === 'catalog' && !item) {
      issues[`types[${i}].catalog`] = t.catalogCode
        ? 'Not in the catalog'
        : 'Pick a cabinet from the catalog'
      unresolved.add(i)
      return { id: t.id, name: t.name.trim() || `Box ${i + 1}`, color: t.color, dims: NO_DIMS, qty }
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
  const result = packMany(container, types, { keepUpright: draft.keepUpright })
  return { scale, issues, scenario, result, stale: false }
}

// ---------------------------------------------------------------------------
// Draft edits. Each returns a new draft and leaves the input untouched.

export type ContainerKey = 'l' | 'w' | 'h'
export type TypeField = 'name' | 'l' | 'w' | 'h' | 'qty'

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
  setUnit(draft: Draft, unit: Unit): Draft {
    return { ...draft, unit }
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
      qty: '1',
      color: nextColor(draft.types.map((t) => t.color)),
    }
    return { ...draft, types: [...draft.types, type] }
  },
  /** Picks a catalog item; its size is also copied into the fields so a later switch to custom starts from it. */
  setCatalogItem(draft: Draft, id: string, code: string): Draft {
    const item = findCatalogItem(code)
    const texts = item ? catalogTexts(item, draft.unit) : null
    return {
      ...draft,
      types: draft.types.map((t) =>
        t.id === id ? { ...t, kind: 'catalog', catalogCode: code, name: code, ...texts } : t,
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
  /** Replaces the box list with an import, and the container settings when the file carried them. */
  applyImport(draft: Draft, imported: ScenarioImport): Draft {
    const c = imported.container
    return {
      ...draft,
      types: imported.types,
      ...(c
        ? {
            containerType: c.containerType,
            container: c.container ?? draft.container,
            unit: c.unit,
            keepUpright: c.keepUpright,
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

/** Reads a draft back from JSON, rejecting anything that does not have the expected shape. */
export function parseDraft(json: string): Draft | null {
  try {
    const raw: unknown = JSON.parse(json)
    if (!raw || typeof raw !== 'object') return null
    const d = raw as Record<string, unknown>
    const c = d.container as Record<string, unknown> | undefined
    if (!c || !isString(c.l) || !isString(c.w) || !isString(c.h)) return null
    if (!Array.isArray(d.types)) return null
    if (!UNITS.includes(d.unit as Unit)) return null
    // Drafts saved before container presets existed have no type: they are custom.
    const containerType = d.containerType === undefined ? 'custom' : d.containerType
    if (!CONTAINER_TYPES.includes(containerType as ContainerType)) return null
    const types: BoxTypeDraft[] = []
    for (const t of d.types as unknown[]) {
      const r = t as Record<string, unknown>
      if (!r || !isString(r.id) || !isString(r.name) || !isString(r.color)) return null
      if (!isString(r.l) || !isString(r.w) || !isString(r.h) || !isString(r.qty)) return null
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
        qty: r.qty,
        color: r.color,
      })
    }
    return {
      containerType: containerType as ContainerType,
      container: { l: c.l, w: c.w, h: c.h },
      types,
      keepUpright: d.keepUpright === true,
      unit: d.unit as Unit,
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
