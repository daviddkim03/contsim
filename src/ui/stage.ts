import { query, setText } from './dom'
import type { Panel } from './sidebar'
import { shownContainer, shownResult, type AppState, type Store } from './state'
import { formatLength } from './units'
import { mountViewer } from './viewer3d'

/**
 * The center panel: the 3D view with a floating toolbar (container switcher,
 * layer slider, reset view).
 */
export function mountStage(root: HTMLElement, store: Store): Panel {
  root.innerHTML = `
    <div class="stage-toolbar">
      <div class="container-switch" data-role="container-switch" hidden>
        <button type="button" class="ghost" data-action="prev-container" aria-label="Previous container">‹</button>
        <span data-role="container-label">Container 1 of 1</span>
        <button type="button" class="ghost" data-action="next-container" aria-label="Next container">›</button>
      </div>
      <label class="layer" data-role="layer">
        <span data-role="layer-label">Layer: all</span>
        <input type="range" data-field="layer" min="0" max="1" step="1" aria-label="Layer height">
      </label>
      <button type="button" class="ghost" data-action="reset-view">Reset view</button>
    </div>
    <div class="stage-3d"></div>
  `
  const viewer = mountViewer(query(root, '.stage-3d'))
  const switcher = query<HTMLElement>(root, '[data-role="container-switch"]')
  const switcherLabel = query<HTMLElement>(root, '[data-role="container-label"]')
  const layerLabel = query<HTMLElement>(root, '[data-role="layer-label"]')
  const layerSlider = query<HTMLInputElement>(root, '[data-field="layer"]')

  const step = (delta: number) => {
    const state = store.get()
    const n = shownResult(state)?.containers.length ?? 0
    if (n < 2) return
    store.setView({ container: (shownContainer(state).index + delta + n) % n })
  }
  query(root, '[data-action="prev-container"]').addEventListener('click', () => step(-1))
  query(root, '[data-action="next-container"]').addEventListener('click', () => step(1))
  layerSlider.addEventListener('input', () => {
    const value = Number(layerSlider.value)
    store.setView({ layer: value >= Number(layerSlider.max) ? null : value })
  })
  query(root, '[data-action="reset-view"]').addEventListener('click', () => viewer.resetView())

  return {
    render(state: AppState) {
      const { view, derived, draft } = state
      const containers = shownResult(state)?.containers.length ?? 0
      switcher.hidden = containers < 2
      setText(switcherLabel, `Container ${shownContainer(state).index + 1} of ${containers}`)

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
    },
  }
}
