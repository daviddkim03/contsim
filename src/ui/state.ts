import {
  pack,
  validateScenario,
  type BoxType,
  type Container,
  type Objective,
  type OptimizeResult,
  type PackResult,
  type Scenario,
} from '../core'
import { exampleScenario } from '../scenarios'
import { nextColor } from './palette'
import { UNITS, parseCount, parseLength, scaleFor, toInt, type Unit } from './units'

/** What the user typed. Strings, so partial or invalid input survives a render and can be flagged. */
export interface BoxTypeDraft {
  id: string
  name: string
  l: string
  w: string
  h: string
  qty: string
  color: string
}

export interface Draft {
  container: { l: string; w: string; h: string }
  types: BoxTypeDraft[]
  keepUpright: boolean
  unit: Unit
}

/** Everything computed from the draft. */
export interface Derived {
  scale: number
  /** Field path (e.g. "types[1].dims.h") to message. Empty when the draft is valid. */
  issues: Record<string, string>
  scenario: Scenario | null
  result: PackResult | null
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
}

export const DEFAULT_VIEW: ViewState = {
  mode: '3d',
  layer: null,
  showContainer: true,
  hoverTypeId: null,
}

/** Optimizer run state. Any edit of the draft resets it to idle. */
export interface OptimizeUiState {
  status: 'idle' | 'running' | 'done' | 'failed'
  objective: Objective
  runs: number
  maxRuns: number
  bestKept: number
  result: OptimizeResult | null
  error: string | null
}

export const DEFAULT_OPTIMIZE: OptimizeUiState = {
  status: 'idle',
  objective: 'keep-most-boxes',
  runs: 0,
  maxRuns: 0,
  bestKept: 0,
  result: null,
  error: null,
}

export interface AppState {
  draft: Draft
  derived: Derived
  view: ViewState
  optimize: OptimizeUiState
}

/** The packing to display: the optimizer's proposal while one is shown, otherwise the current result. */
export function shownResult(state: AppState): PackResult | null {
  const o = state.optimize
  if (o.status === 'done' && o.result) return o.result.result
  return state.derived.result
}

// ---------------------------------------------------------------------------
// Draft <-> scenario

export function draftFromScenario(scenario: Scenario, unit: Unit): Draft {
  const s = (n: number) => String(n)
  return {
    container: {
      l: s(scenario.container.l),
      w: s(scenario.container.w),
      h: s(scenario.container.h),
    },
    keepUpright: scenario.keepUpright,
    unit,
    types: scenario.types.map((t) => ({
      id: t.id,
      name: t.name,
      l: s(t.dims.l),
      w: s(t.dims.w),
      h: s(t.dims.h),
      qty: s(t.qty),
      color: t.color,
    })),
  }
}

export const exampleDraft = (): Draft => draftFromScenario(exampleScenario(), 'in')

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Parses, scales, validates and packs the draft. Pure and synchronous; a few milliseconds. */
export function derive(draft: Draft): Derived {
  const issues: Record<string, string> = {}
  const texts = [
    draft.container.l,
    draft.container.w,
    draft.container.h,
    ...draft.types.flatMap((t) => [t.l, t.w, t.h]),
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
    l: length('container.l', draft.container.l),
    w: length('container.w', draft.container.w),
    h: length('container.h', draft.container.h),
  }
  const types: BoxType[] = draft.types.map((t, i) => ({
    id: t.id,
    name: t.name.trim() || `Box ${i + 1}`,
    color: t.color,
    dims: {
      l: length(`types[${i}].dims.l`, t.l),
      w: length(`types[${i}].dims.w`, t.w),
      h: length(`types[${i}].dims.h`, t.h),
    },
    qty: count(`types[${i}].qty`, t.qty),
  }))

  for (const issue of validateScenario(container, types)) {
    if (!(issue.path in issues)) issues[issue.path] = capitalize(issue.message)
  }
  if (Object.keys(issues).length > 0) {
    return { scale, issues, scenario: null, result: null, stale: false }
  }

  const scenario: Scenario = { container, types, keepUpright: draft.keepUpright }
  const result = pack(container, types, { keepUpright: draft.keepUpright })
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
  setUnit(draft: Draft, unit: Unit): Draft {
    return { ...draft, unit }
  },
  setKeepUpright(draft: Draft, keepUpright: boolean): Draft {
    return { ...draft, keepUpright }
  },
  addType(draft: Draft): Draft {
    const type: BoxTypeDraft = {
      id: newTypeId(draft.types.map((t) => t.id)),
      name: newTypeName(draft.types),
      l: '',
      w: '',
      h: '',
      qty: '1',
      color: nextColor(draft.types.map((t) => t.color)),
    }
    return { ...draft, types: [...draft.types, type] }
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
    const types: BoxTypeDraft[] = []
    for (const t of d.types as unknown[]) {
      const r = t as Record<string, unknown>
      if (!r || !isString(r.id) || !isString(r.name) || !isString(r.color)) return null
      if (!isString(r.l) || !isString(r.w) || !isString(r.h) || !isString(r.qty)) return null
      types.push({ id: r.id, name: r.name, l: r.l, w: r.w, h: r.h, qty: r.qty, color: r.color })
    }
    return {
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
      optimize: { ...DEFAULT_OPTIMIZE, objective: this.state.optimize.objective },
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
