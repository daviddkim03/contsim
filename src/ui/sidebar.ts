import type { Objective } from '../core'
import { OBJECTIVE_LABELS } from './describe'
import { download, h, query, setInvalid, setValue, setText } from './dom'
import { wireHover } from './legend'
import type { OptimizeController } from './optimizeClient'
import { buildReport, EXCEL_FILENAME } from './report'
import {
  edits,
  exampleDraft,
  parseDraft,
  serializeDraft,
  type AppState,
  type BoxTypeDraft,
  type ContainerKey,
  type Store,
  type TypeField,
} from './state'
import { UNITS, type Unit } from './units'
import { writeXlsx, XLSX_MIME } from './xlsx'

export interface Panel {
  render(state: AppState): void
}

const CONTAINER_KEYS: ContainerKey[] = ['l', 'w', 'h']
const TYPE_FIELDS: TypeField[] = ['name', 'l', 'w', 'h', 'qty']
const OBJECTIVES = Object.entries(OBJECTIVE_LABELS) as [Objective, string][]
export const JSON_FILENAME = 'contsim-scenario.json'

export function mountSidebar(
  root: HTMLElement,
  store: Store,
  optimizer: OptimizeController,
): Panel {
  root.innerHTML = `
    <header class="brand">
      <h1>contsim</h1>
      <span class="tagline">container packing simulator</span>
    </header>

    <section class="panel">
      <div class="panel-title">
        <h2>Container</h2>
        <select class="unit-select" data-field="unit" aria-label="Unit">
          ${UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}
        </select>
      </div>
      <div class="dims">
        <label><span>L</span><input data-field="container.l" inputmode="decimal" autocomplete="off" aria-label="Container length"></label>
        <span class="times">×</span>
        <label><span>W</span><input data-field="container.w" inputmode="decimal" autocomplete="off" aria-label="Container width"></label>
        <span class="times">×</span>
        <label><span>H</span><input data-field="container.h" inputmode="decimal" autocomplete="off" aria-label="Container height"></label>
      </div>
      <p class="hint">Interior dimensions</p>
    </section>

    <section class="panel boxes">
      <div class="panel-title">
        <h2>Boxes</h2>
        <button type="button" class="ghost" data-action="add">+ Add box</button>
      </div>
      <ul class="box-list"></ul>
      <p class="empty hint">No boxes yet. Add one to get started.</p>
    </section>

    <section class="panel">
      <label class="check">
        <input type="checkbox" data-field="keepUpright">
        <span>Keep boxes upright</span>
      </label>
      <p class="hint">Only rotate around the vertical axis</p>
    </section>

    <footer class="sidebar-actions">
      <div class="optimize-row">
        <button type="button" class="primary" data-action="optimize">Optimize</button>
        <select data-field="objective" aria-label="Optimize objective">
          ${OBJECTIVES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="ghost" data-action="cancel-optimize" hidden>Cancel</button>
      <div class="file-row">
        <button type="button" class="ghost" data-action="example">Load example</button>
        <button type="button" class="ghost" data-action="import">Import JSON</button>
        <button type="button" class="ghost" data-action="export-json">Export JSON</button>
        <button type="button" class="ghost" data-action="export-excel">Export Excel</button>
        <input type="file" accept="application/json,.json" data-field="import-file" hidden>
      </div>
      <p class="hint" data-role="footer-hint">Results update as you type</p>
    </footer>
  `

  const containerInputs = Object.fromEntries(
    CONTAINER_KEYS.map((k) => [k, query<HTMLInputElement>(root, `[data-field="container.${k}"]`)]),
  ) as Record<ContainerKey, HTMLInputElement>
  const unitSelect = query<HTMLSelectElement>(root, '[data-field="unit"]')
  const uprightCheckbox = query<HTMLInputElement>(root, '[data-field="keepUpright"]')
  const list = query<HTMLUListElement>(root, '.box-list')
  const empty = query<HTMLElement>(root, '.empty')
  const optimizeButton = query<HTMLButtonElement>(root, '[data-action="optimize"]')
  const cancelButton = query<HTMLButtonElement>(root, '[data-action="cancel-optimize"]')
  const objectiveSelect = query<HTMLSelectElement>(root, '[data-field="objective"]')
  const importInput = query<HTMLInputElement>(root, '[data-field="import-file"]')
  const excelButton = query<HTMLButtonElement>(root, '[data-action="export-excel"]')
  const footerHint = query<HTMLElement>(root, '[data-role="footer-hint"]')
  let notice: string | null = null
  wireHover(list, '.box-row', store)

  // Text inputs: every keystroke is an edit.
  root.addEventListener('input', (event) => {
    const target = event.target
    if (
      !(target instanceof HTMLInputElement) ||
      (target.type !== 'text' && target.type !== 'number')
    ) {
      return
    }
    const field = target.dataset.field
    if (!field) return
    const row = target.closest<HTMLElement>('li[data-id]')
    if (row) {
      const id = row.dataset.id!
      if (TYPE_FIELDS.includes(field as TypeField)) {
        store.edit((d) => edits.setTypeField(d, id, field as TypeField, target.value))
      }
    } else if (field.startsWith('container.')) {
      const key = field.slice('container.'.length) as ContainerKey
      store.edit((d) => edits.setContainer(d, key, target.value))
    }
  })

  root.addEventListener('change', (event) => {
    const target = event.target
    if (target === unitSelect) store.edit((d) => edits.setUnit(d, unitSelect.value as Unit))
    if (target === uprightCheckbox) {
      store.edit((d) => edits.setKeepUpright(d, uprightCheckbox.checked))
    }
    if (target === objectiveSelect) {
      store.setOptimize({ objective: objectiveSelect.value as Objective })
    }
    if (target === importInput) void importFile(importInput.files?.[0])
  })

  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
    if (!button || button.disabled) return
    const row = button.closest<HTMLElement>('li[data-id]')
    const id = row?.dataset.id
    switch (button.dataset.action) {
      case 'add':
        store.edit((d) => edits.addType(d))
        list.querySelector<HTMLInputElement>('li:last-child input[data-field="l"]')?.focus()
        break
      case 'remove':
        if (id) store.edit((d) => edits.removeType(d, id))
        break
      case 'inc':
        if (id) store.edit((d) => edits.stepQty(d, id, 1))
        break
      case 'dec':
        if (id) store.edit((d) => edits.stepQty(d, id, -1))
        break
      case 'optimize':
        optimizer.start()
        break
      case 'cancel-optimize':
        optimizer.cancel()
        break
      case 'example': {
        const current = JSON.stringify(store.get().draft)
        const example = exampleDraft()
        if (current === JSON.stringify(example)) return
        if (window.confirm('Replace the current scenario with the example?')) {
          store.edit(() => example)
        }
        break
      }
      case 'export-json':
        download(
          new Blob([serializeDraft(store.get().draft)], { type: 'application/json' }),
          JSON_FILENAME,
        )
        break
      case 'export-excel':
        void exportExcel()
        break
      case 'import':
        importInput.value = ''
        importInput.click()
        break
    }
  })

  async function exportExcel(): Promise<void> {
    // A recompute may still be pending after a keystroke; the report must match the inputs.
    store.flush()
    const workbook = buildReport(store.get())
    if (!workbook) return
    download(new Blob([await writeXlsx(workbook)], { type: XLSX_MIME }), EXCEL_FILENAME)
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return
    const draft = parseDraft(await file.text())
    if (!draft) {
      notice = `${file.name} is not a contsim scenario.`
      render(store.get())
      return
    }
    notice = null
    store.edit(() => draft)
  }

  function createRow(id: string): HTMLLIElement {
    const row = h('li', { class: 'box-row', 'data-id': id })
    row.innerHTML = `
      <div class="row-top">
        <span class="swatch"></span>
        <input class="name" data-field="name" placeholder="Name" autocomplete="off" aria-label="Box name">
        <button type="button" class="icon" data-action="remove" aria-label="Remove box" title="Remove box">×</button>
      </div>
      <div class="row-bottom">
        <div class="dims compact">
          <input data-field="l" inputmode="decimal" placeholder="L" autocomplete="off" aria-label="Length">
          <span class="times">×</span>
          <input data-field="w" inputmode="decimal" placeholder="W" autocomplete="off" aria-label="Width">
          <span class="times">×</span>
          <input data-field="h" inputmode="decimal" placeholder="H" autocomplete="off" aria-label="Height">
        </div>
        <div class="stepper">
          <button type="button" data-action="dec" aria-label="Decrease quantity">-</button>
          <input type="number" min="0" step="1" data-field="qty" aria-label="Quantity">
          <button type="button" data-action="inc" aria-label="Increase quantity">+</button>
        </div>
      </div>
    `
    return row
  }

  function updateRow(
    row: HTMLLIElement,
    type: BoxTypeDraft,
    index: number,
    issues: Record<string, string>,
  ): void {
    query<HTMLElement>(row, '.swatch').style.background = type.color
    for (const field of TYPE_FIELDS) {
      const input = query<HTMLInputElement>(row, `[data-field="${field}"]`)
      setValue(input, type[field])
      const path = field === 'qty' ? `types[${index}].qty` : `types[${index}].dims.${field}`
      setInvalid(input, field === 'name' ? undefined : issues[path])
    }
  }

  function render(state: AppState): void {
    const { draft, derived, optimize } = state
    for (const key of CONTAINER_KEYS) {
      setValue(containerInputs[key], draft.container[key])
      setInvalid(containerInputs[key], derived.issues[`container.${key}`])
    }
    setValue(unitSelect, draft.unit)
    uprightCheckbox.checked = draft.keepUpright

    const existing = new Map<string, HTMLLIElement>()
    for (const li of list.querySelectorAll<HTMLLIElement>('li[data-id]')) {
      existing.set(li.dataset.id!, li)
    }
    draft.types.forEach((type, index) => {
      let row = existing.get(type.id)
      if (row) existing.delete(type.id)
      else row = createRow(type.id)
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null)
      updateRow(row, type, index, derived.issues)
    })
    for (const row of existing.values()) row.remove()
    empty.hidden = draft.types.length > 0

    const running = optimize.status === 'running'
    const result = derived.result
    optimizeButton.disabled = !result || result.status === 'fits' || running || derived.stale
    setText(
      optimizeButton,
      running ? `Optimizing ${optimize.runs} / ${optimize.maxRuns}` : 'Optimize',
    )
    cancelButton.hidden = !running
    excelButton.disabled = !result
    setValue(objectiveSelect, optimize.objective)
    objectiveSelect.disabled = running
    footerHint.classList.toggle('error', notice !== null)
    setText(
      footerHint,
      notice ??
        (!result
          ? 'Fix the inputs first'
          : result.status === 'fits'
            ? 'Everything fits, nothing to optimize'
            : 'Results update as you type'),
    )
  }

  store.subscribe(() => {
    notice = null
  })

  return { render }
}
