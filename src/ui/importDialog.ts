/**
 * The dialog shown before an import lands: what the file holds, which unit
 * its sizes are in, and what the import replaces. Sizes only mean something
 * with a unit, and a spreadsheet rarely says which one it used, so the app
 * asks instead of guessing.
 */

import { h, query, setText, setValue } from './dom'
import { UNITS, type Unit } from './units'

export interface ImportSummary {
  fileName: string
  /** Box rows the file yields. */
  rows: number
  boxes: number
  /** Rows that will be left out. */
  skipped: number
  /** Box rows the import replaces. */
  replaces: number
  /** Unit selected when the dialog opens. */
  unit: Unit
  /** False when the file states its own unit (a workbook saved by contsim). */
  askUnit: boolean
}

let dialog: HTMLDialogElement | null = null
let unitSelect: HTMLSelectElement

/** "1 row", "2 rows", "1 box", "2 boxes". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function build(): HTMLDialogElement {
  const el = h('dialog', { class: 'import-dialog' })
  el.innerHTML = `
    <form method="dialog">
      <h2>Import order</h2>
      <p class="file" data-role="file"></p>
      <label class="unit-row" data-role="unit-row">
        <span>Sizes in this file are in</span>
        <select data-field="import-unit" aria-label="Unit used in the file">
          ${UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}
        </select>
      </label>
      <p class="hint" data-role="unit-note">
        A header that names its own unit, such as “Width (mm)”, keeps it. The app switches to the
        unit chosen here.
      </p>
      <p class="counts" data-role="counts"></p>
      <div class="dialog-actions">
        <button type="button" class="ghost" data-action="cancel">Cancel</button>
        <button type="button" class="primary" data-action="confirm">Import</button>
      </div>
    </form>
  `
  document.body.append(el)
  unitSelect = query<HTMLSelectElement>(el, '[data-field="import-unit"]')
  el.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset
      .action
    if (action === 'confirm') el.close('import')
    else if (action === 'cancel') el.close('')
  })
  return el
}

/**
 * Opens the dialog and resolves with the unit to import in, or null when the
 * user backs out (Cancel or Escape).
 */
export function promptImport(summary: ImportSummary): Promise<Unit | null> {
  dialog ??= build()
  const el = dialog
  setText(query(el, '[data-role="file"]'), summary.fileName)
  query<HTMLElement>(el, '[data-role="unit-row"]').hidden = !summary.askUnit
  query<HTMLElement>(el, '[data-role="unit-note"]').hidden = !summary.askUnit
  setValue(unitSelect, summary.unit)

  const parts = [`${count(summary.rows, 'box row')}, ${count(summary.boxes, 'box', 'boxes')}.`]
  if (summary.skipped > 0) parts.push(`${count(summary.skipped, 'row')} will be skipped.`)
  if (summary.replaces > 0) parts.push(`Replaces the current ${count(summary.replaces, 'row')}.`)
  setText(query(el, '[data-role="counts"]'), parts.join(' '))

  return new Promise((resolve) => {
    el.addEventListener(
      'close',
      () => resolve(el.returnValue === 'import' ? (unitSelect.value as Unit) : null),
      { once: true },
    )
    el.showModal()
    query<HTMLButtonElement>(el, '[data-action="confirm"]').focus()
  })
}
