import { h, query, setText } from './dom'
import { mountPlacementsTable } from './placementsTable'
import type { Panel } from './sidebar'
import { edits, type AppState, type Store } from './state'
import { formatLength } from './units'
import { mountViewer } from './viewer3d'

/**
 * The center panel: floating toolbar, 3D view, the placements table as an
 * alternative view, and the optimizer's result popover.
 */
export function mountStage(root: HTMLElement, store: Store): Panel {
  root.innerHTML = `
    <div class="stage-toolbar">
      <div class="segmented" role="group" aria-label="View mode">
        <button type="button" data-mode="3d">3D</button>
        <button type="button" data-mode="table">Table</button>
      </div>
      <label class="check small" data-role="container-toggle">
        <input type="checkbox" data-field="showContainer">
        <span>Container</span>
      </label>
      <label class="layer" data-role="layer">
        <span data-role="layer-label">Layer: all</span>
        <input type="range" data-field="layer" min="0" max="1" step="1" aria-label="Layer height">
      </label>
      <button type="button" class="ghost" data-action="reset-view">Reset view</button>
    </div>
    <div class="stage-3d"></div>
    <div class="stage-table" hidden></div>
    <div class="optimize-popover" hidden>
      <div class="popover-title">
        <strong data-role="popover-title"></strong>
        <span class="hint" data-role="popover-subtitle"></span>
      </div>
      <ul class="reductions"></ul>
      <p class="hint" data-role="popover-note"></p>
      <div class="popover-actions">
        <button type="button" class="primary" data-action="apply">Apply</button>
        <button type="button" class="ghost" data-action="discard">Discard</button>
      </div>
    </div>
  `
  const viewer = mountViewer(query(root, '.stage-3d'), store)
  const table = mountPlacementsTable(query(root, '.stage-table'), store)
  const modeButtons = root.querySelectorAll<HTMLButtonElement>('[data-mode]')
  const containerToggle = query<HTMLInputElement>(root, '[data-field="showContainer"]')
  const containerLabel = query<HTMLElement>(root, '[data-role="container-toggle"]')
  const layerWrap = query<HTMLElement>(root, '[data-role="layer"]')
  const layerLabel = query<HTMLElement>(root, '[data-role="layer-label"]')
  const layerSlider = query<HTMLInputElement>(root, '[data-field="layer"]')
  const resetButton = query<HTMLButtonElement>(root, '[data-action="reset-view"]')
  const view3d = query<HTMLElement>(root, '.stage-3d')
  const viewTable = query<HTMLElement>(root, '.stage-table')
  const popover = query<HTMLElement>(root, '.optimize-popover')
  const popoverTitle = query<HTMLElement>(root, '[data-role="popover-title"]')
  const popoverSubtitle = query<HTMLElement>(root, '[data-role="popover-subtitle"]')
  const popoverNote = query<HTMLElement>(root, '[data-role="popover-note"]')
  const reductions = query<HTMLUListElement>(root, '.reductions')
  const applyButton = query<HTMLButtonElement>(root, '[data-action="apply"]')
  const discardButton = query<HTMLButtonElement>(root, '[data-action="discard"]')

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      store.setView({ mode: button.dataset.mode === 'table' ? 'table' : '3d' })
    })
  }
  containerToggle.addEventListener('change', () => {
    store.setView({ showContainer: containerToggle.checked })
  })
  layerSlider.addEventListener('input', () => {
    const value = Number(layerSlider.value)
    store.setView({ layer: value >= Number(layerSlider.max) ? null : value })
  })
  resetButton.addEventListener('click', () => viewer.resetView())
  applyButton.addEventListener('click', () => {
    const result = store.get().optimize.result
    if (result) store.edit((d) => edits.setQuantities(d, result.kept))
  })
  discardButton.addEventListener('click', () => {
    store.setOptimize({ status: 'idle', result: null, error: null })
  })

  const duration = (ms: number) =>
    ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`

  function renderPopover(state: AppState): void {
    const { optimize, derived } = state
    if (optimize.status === 'failed') {
      popover.hidden = false
      setText(popoverTitle, 'Optimize failed')
      setText(popoverSubtitle, optimize.error ?? '')
      reductions.replaceChildren()
      setText(popoverNote, '')
      applyButton.hidden = true
      setText(discardButton, 'Dismiss')
      return
    }
    const result = optimize.status === 'done' ? optimize.result : null
    popover.hidden = !result
    if (!result || !derived.scenario) return

    const types = derived.scenario.types
    const requested = types.reduce((n, t) => n + t.qty, 0)
    const kept = Object.values(result.kept).reduce((a, b) => a + b, 0)
    const removed = requested - kept
    setText(popoverTitle, removed === 0 ? 'Everything fits' : `Keep ${kept} of ${requested} boxes`)
    setText(popoverSubtitle, `${result.runs} packer runs, ${duration(result.ms)}`)
    reductions.replaceChildren(
      ...types
        .filter((t) => (result.removed[t.id] ?? 0) > 0)
        .map((t) => {
          const swatch = h('span', { class: 'swatch' })
          swatch.style.background = t.color
          const change = `${t.qty} → ${result.kept[t.id] ?? 0}`
          return h('li', {}, [
            swatch,
            h('span', { class: 'reduction-name', text: t.name }),
            h('span', { class: 'reduction-change', text: change }),
          ])
        }),
    )
    setText(
      popoverNote,
      removed === 0
        ? ''
        : `Removes ${removed} ${removed === 1 ? 'box' : 'boxes'}. The view shows the proposed packing.`,
    )
    applyButton.hidden = false
    setText(discardButton, 'Discard')
  }

  return {
    render(state: AppState) {
      const { view, derived, draft } = state
      const is3d = view.mode === '3d'
      view3d.hidden = !is3d
      viewTable.hidden = is3d
      for (const button of modeButtons) {
        button.classList.toggle('active', (button.dataset.mode === 'table') !== is3d)
      }
      containerLabel.hidden = !is3d
      layerWrap.hidden = !is3d
      resetButton.hidden = !is3d
      containerToggle.checked = view.showContainer

      const height = derived.scenario?.container.h
      if (height !== undefined) {
        layerSlider.max = String(height)
        layerSlider.disabled = false
        const value = view.layer === null ? height : Math.min(view.layer, height)
        if (Number(layerSlider.value) !== value) layerSlider.value = String(value)
        setText(
          layerLabel,
          view.layer === null || view.layer >= height
            ? 'Layer: all'
            : `Layer: up to ${formatLength(view.layer, derived.scale, draft.unit)}`,
        )
      } else {
        layerSlider.disabled = true
      }

      renderPopover(state)
      viewer.render(state)
      table.render(state)
    },
  }
}
