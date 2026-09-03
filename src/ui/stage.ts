import { query, setText } from './dom'
import { mountPlacementsTable } from './placementsTable'
import type { Panel } from './sidebar'
import { shownContainer, shownResult, type AppState, type Store } from './state'
import { formatLength } from './units'
import { mountViewer } from './viewer3d'

/**
 * The center panel: floating toolbar (view mode, container switcher,
 * container outline, layer slider, reset), the 3D view, and the placements
 * table as an alternative view.
 */
export function mountStage(root: HTMLElement, store: Store): Panel {
  root.innerHTML = `
    <div class="stage-toolbar">
      <div class="segmented" role="group" aria-label="View mode">
        <button type="button" data-mode="3d">3D</button>
        <button type="button" data-mode="table">Table</button>
      </div>
      <div class="container-switch" data-role="container-switch" hidden>
        <button type="button" class="ghost" data-action="prev-container" aria-label="Previous container">‹</button>
        <span data-role="container-label">Container 1 of 1</span>
        <button type="button" class="ghost" data-action="next-container" aria-label="Next container">›</button>
      </div>
      <label class="check small" data-role="container-toggle">
        <input type="checkbox" data-field="showContainer">
        <span>Outline</span>
      </label>
      <label class="layer" data-role="layer">
        <span data-role="layer-label">Layer: all</span>
        <input type="range" data-field="layer" min="0" max="1" step="1" aria-label="Layer height">
      </label>
      <button type="button" class="ghost" data-action="reset-view">Reset view</button>
    </div>
    <div class="stage-3d"></div>
    <div class="stage-table" hidden></div>
  `
  const viewer = mountViewer(query(root, '.stage-3d'), store)
  const table = mountPlacementsTable(query(root, '.stage-table'), store)
  const modeButtons = root.querySelectorAll<HTMLButtonElement>('[data-mode]')
  const switcher = query<HTMLElement>(root, '[data-role="container-switch"]')
  const switcherLabel = query<HTMLElement>(root, '[data-role="container-label"]')
  const containerToggle = query<HTMLInputElement>(root, '[data-field="showContainer"]')
  const containerLabel = query<HTMLElement>(root, '[data-role="container-toggle"]')
  const layerWrap = query<HTMLElement>(root, '[data-role="layer"]')
  const layerLabel = query<HTMLElement>(root, '[data-role="layer-label"]')
  const layerSlider = query<HTMLInputElement>(root, '[data-field="layer"]')
  const resetButton = query<HTMLButtonElement>(root, '[data-action="reset-view"]')
  const view3d = query<HTMLElement>(root, '.stage-3d')
  const viewTable = query<HTMLElement>(root, '.stage-table')

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      store.setView({ mode: button.dataset.mode === 'table' ? 'table' : '3d' })
    })
  }
  const step = (delta: number) => {
    const state = store.get()
    const n = shownResult(state)?.containers.length ?? 0
    if (n < 2) return
    store.setView({ container: (shownContainer(state).index + delta + n) % n })
  }
  query(root, '[data-action="prev-container"]').addEventListener('click', () => step(-1))
  query(root, '[data-action="next-container"]').addEventListener('click', () => step(1))
  containerToggle.addEventListener('change', () => {
    store.setView({ showContainer: containerToggle.checked })
  })
  layerSlider.addEventListener('input', () => {
    const value = Number(layerSlider.value)
    store.setView({ layer: value >= Number(layerSlider.max) ? null : value })
  })
  resetButton.addEventListener('click', () => viewer.resetView())

  return {
    render(state: AppState) {
      const { view, derived, draft } = state
      const is3d = view.mode === '3d'
      view3d.hidden = !is3d
      viewTable.hidden = is3d
      for (const button of modeButtons) {
        button.classList.toggle('active', (button.dataset.mode === 'table') !== is3d)
      }
      const containers = shownResult(state)?.containers.length ?? 0
      switcher.hidden = !is3d || containers < 2
      setText(switcherLabel, `Container ${shownContainer(state).index + 1} of ${containers}`)
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

      viewer.render(state)
      table.render(state)
    },
  }
}
