import { formatCatalogDims } from './catalogSearch'
import { findCatalogItem } from './catalogStore'
import { h, query, setText, setValue } from './dom'
import { summarizeStatus } from './describe'
import {
  allocationOf,
  edits,
  shownContainer,
  shownResult,
  type AppState,
  type Store,
} from './state'
import type { Panel } from './sidebar'
import { formatNumber, formatVolume, formatWeight, type WeightUnit } from './units'

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)} %`

/** Hovering a row highlights that box type in the 3D view. */
export function wireHover(list: HTMLElement, rowSelector: string, store: Store): void {
  list.addEventListener('mouseover', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(rowSelector)
    const id = row?.dataset.id ?? null
    if (store.get().view.hoverTypeId !== id) store.setView({ hoverTypeId: id })
  })
  list.addEventListener('mouseleave', () => {
    if (store.get().view.hoverTypeId !== null) store.setView({ hoverTypeId: null })
  })
}

/** Status badge, totals, the list of containers (a selector), and the legend. */
export function mountLegend(root: HTMLElement, store: Store): Panel {
  root.innerHTML = `
    <section class="status" data-status="fits">
      <div class="badge"></div>
      <p class="message"></p>
      <ul class="details"></ul>
      <p class="progress" data-role="progress" hidden></p>
      <dl class="stats">
        <div><dt>Containers</dt><dd data-stat="containers"></dd></div>
        <div><dt>Boxes</dt><dd data-stat="placed"></dd></div>
        <div><dt>Fill</dt><dd data-stat="fill"></dd></div>
        <div><dt>Time</dt><dd data-stat="time"></dd></div>
        <div class="wide"><dt>Volume</dt><dd data-stat="volume"></dd></div>
        <div class="wide" data-role="weight-stat"><dt>Weight</dt><dd data-stat="weight"></dd></div>
      </dl>
    </section>
    <section class="containers" hidden>
      <div class="panel-title">
        <h2>Containers</h2>
        <button type="button" class="ghost" data-action="auto-split" hidden>Reset split</button>
      </div>
      <div class="container-list"></div>
    </section>
    <section class="legend">
      <h2>Legend</h2>
      <ul class="legend-list"></ul>
    </section>
  `
  const status = query<HTMLElement>(root, '.status')
  const badge = query<HTMLElement>(root, '.badge')
  const message = query<HTMLElement>(root, '.message')
  const details = query<HTMLUListElement>(root, '.details')
  const progress = query<HTMLElement>(root, '[data-role="progress"]')
  const stats = {
    containers: query<HTMLElement>(root, '[data-stat="containers"]'),
    placed: query<HTMLElement>(root, '[data-stat="placed"]'),
    fill: query<HTMLElement>(root, '[data-stat="fill"]'),
    time: query<HTMLElement>(root, '[data-stat="time"]'),
    volume: query<HTMLElement>(root, '[data-stat="volume"]'),
    weight: query<HTMLElement>(root, '[data-stat="weight"]'),
  }
  const weightStat = query<HTMLElement>(root, '[data-role="weight-stat"]')
  const containersSection = query<HTMLElement>(root, '.containers')
  const containerList = query<HTMLElement>(root, '.container-list')
  const autoSplitButton = query<HTMLButtonElement>(root, '[data-action="auto-split"]')
  autoSplitButton.addEventListener('click', () => store.edit(edits.clearAllocation))
  const legendList = query<HTMLUListElement>(root, '.legend-list')
  wireHover(legendList, '.legend-row', store)

  containerList.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
    if (row) store.setView({ container: Number(row.dataset.index) })
  })

  function renderStatus(state: AppState): void {
    const { draft, derived, optimize } = state
    const result = shownResult(state)
    const { level, label, text, lines } = summarizeStatus(draft, derived, result)

    status.dataset.status = level
    status.classList.toggle('stale', derived.stale)
    setText(badge, label)
    setText(message, text)
    details.replaceChildren(...lines.map((line) => h('li', { text: line })))
    details.hidden = lines.length === 0

    if (optimize.status === 'running') {
      progress.hidden = false
      setText(progress, `Optimizing container fill… ${optimize.runs} / ${optimize.maxRuns} runs`)
    } else if (optimize.status === 'failed') {
      progress.hidden = false
      setText(progress, `Optimizer unavailable: ${optimize.error ?? 'unknown error'}`)
    } else {
      progress.hidden = true
    }

    if (result) {
      const { scale } = derived
      const unit = draft.unit
      const n = result.stats.containers
      setText(stats.containers, String(n))
      setText(stats.placed, `${result.stats.placed} / ${result.stats.requested}`)
      setText(stats.fill, percent(result.stats.fill))
      const capacity = formatVolume(result.stats.containerVolume * Math.max(n, 1), scale, unit)
      const placedVolume = formatVolume(result.stats.placedVolume, scale, unit)
      const unitLabel = capacity.slice(capacity.indexOf(' '))
      setText(stats.volume, `${placedVolume.replace(unitLabel, '')} / ${capacity}`)
      setText(stats.time, `${result.stats.ms < 1 ? '<1' : Math.round(result.stats.ms)} ms`)
      // Weight is only worth a line once some box has one.
      const { weight, maxWeight } = result.stats
      weightStat.hidden = weight === 0 && maxWeight === 0
      const load = formatWeight(weight, draft.weightUnit)
      setText(
        stats.weight,
        maxWeight > 0
          ? `${load.replace(` ${draft.weightUnit}`, '')} / ${formatWeight(maxWeight * Math.max(n, 1), draft.weightUnit)}`
          : load,
      )
    } else {
      for (const el of Object.values(stats)) setText(el, '-')
    }
  }

  /** A second line and bar for the load, when weights are in play. */
  function weightLine(weight: number, maxWeight: number, unit: WeightUnit): HTMLElement[] {
    if (weight === 0 && maxWeight === 0) return []
    const text = h('span', {
      class: 'container-meta wide',
      text:
        maxWeight > 0
          ? `${formatWeight(weight, unit).replace(` ${unit}`, '')} / ${formatWeight(maxWeight, unit)}`
          : formatWeight(weight, unit),
    })
    if (maxWeight === 0) return [text]
    const bar = h('span', { class: 'fill-bar weight' })
    const value = h('span', { class: 'fill-bar-value' })
    value.style.width = `${Math.min(100, Math.round((weight / maxWeight) * 100))}%`
    bar.append(value)
    if (weight > maxWeight * 0.98) bar.classList.add('heavy')
    return [text, bar]
  }

  function renderContainers(state: AppState): void {
    const result = shownResult(state)
    const n = result?.containers.length ?? 0
    containersSection.hidden = n < 2
    if (!result || n < 2) {
      containerList.replaceChildren()
      return
    }
    const selected = shownContainer(state).index
    autoSplitButton.hidden = allocationOf(state.draft) === undefined
    containerList.replaceChildren(
      ...result.containers.map((c, i) => {
        const value = h('span', { class: 'fill-bar-value' })
        value.style.width = `${Math.round(c.stats.fill * 100)}%`
        return h(
          'button',
          {
            type: 'button',
            class: `container-row${i === selected ? ' selected' : ''}`,
            'data-index': String(i),
            'aria-pressed': i === selected ? 'true' : 'false',
          },
          [
            h('span', { class: 'container-name', text: `Container ${i + 1}` }),
            h('span', {
              class: 'container-meta',
              text: `${c.placements.length} boxes · ${percent(c.stats.fill)}`,
            }),
            h('span', { class: 'fill-bar' }, [value]),
            ...weightLine(c.stats.weight, result.stats.maxWeight, state.draft.weightUnit),
          ],
        )
      }),
    )
  }

  /** Boxes of one type in the container on screen. */
  function countHere(state: AppState, typeId: string): number {
    const packing = shownContainer(state).packing
    return packing?.placements.filter((p) => p.typeId === typeId).length ?? 0
  }

  /** One legend row, reused across renders so a count being typed keeps focus. */
  function legendRow(id: string): HTMLLIElement {
    const row = h('li', { class: 'legend-row', 'data-id': id })
    row.innerHTML = `
      <span class="swatch"></span>
      <span class="legend-text">
        <span class="legend-name"></span>
        <span class="legend-dims"></span>
      </span>
      <span class="legend-count">
        <input type="number" min="0" step="1" data-field="here" aria-label="Boxes in this container">
        <span class="legend-total" data-role="total"></span>
      </span>
    `
    const input = query<HTMLInputElement>(row, '[data-field="here"]')
    input.addEventListener('input', () => {
      const state = store.get()
      const count = Number(input.value)
      if (input.value === '' || !Number.isFinite(count)) return
      store.edit((d) => edits.setContainerCount(d, shownContainer(state).index, id, count))
    })
    // Whatever did not fit stayed in the next container, so show what was packed.
    input.addEventListener('blur', () => setValue(input, String(countHere(store.get(), id))))
    return row
  }

  function renderLegend(state: AppState): void {
    const { draft, derived } = state
    const { scenario, scale } = derived
    const result = shownResult(state)
    const editable = (result?.containers.length ?? 0) > 0

    const existing = new Map<string, HTMLLIElement>()
    for (const li of legendList.querySelectorAll<HTMLLIElement>('li[data-id]')) {
      existing.set(li.dataset.id!, li)
    }
    draft.types.forEach((type, index) => {
      let row = existing.get(type.id)
      if (row) existing.delete(type.id)
      else row = legendRow(type.id)
      if (legendList.children[index] !== row) {
        legendList.insertBefore(row, legendList.children[index] ?? null)
      }

      const coreType = scenario?.types[index]
      const requested = coreType?.qty ?? null
      const here = countHere(state, type.id)
      const placed = result
        ? result.containers.reduce(
            (n, c) => n + c.placements.filter((p) => p.typeId === type.id).length,
            0,
          )
        : null
      query<HTMLElement>(row, '.swatch').style.background = type.color
      // While another row is being fixed there is no scenario, so fall back to
      // the catalog and to whatever the row itself holds.
      const item = type.kind === 'catalog' ? findCatalogItem(type.catalogCode) : null
      const dims = coreType
        ? `${formatNumber(coreType.dims.l, scale)} × ${formatNumber(coreType.dims.w, scale)} × ${formatNumber(coreType.dims.h, scale)} ${draft.unit}`
        : item
          ? formatCatalogDims(item, draft.unit)
          : type.kind === 'catalog'
            ? type.catalogCode
              ? 'Not in the catalog'
              : 'No cabinet picked yet'
            : `${type.l || '?'} × ${type.w || '?'} × ${type.h || '?'} ${draft.unit}`
      setText(query(row, '.legend-name'), coreType?.name ?? type.name ?? '')
      setText(query(row, '.legend-dims'), dims)

      const input = query<HTMLInputElement>(row, '[data-field="here"]')
      input.hidden = !editable
      input.disabled = !editable
      if (editable && document.activeElement !== input) setValue(input, String(here))
      const total = query<HTMLElement>(row, '[data-role="total"]')
      total.hidden = editable
      setText(
        total,
        placed !== null && requested !== null ? `${placed} / ${requested}` : type.qty || '?',
      )
      row.classList.toggle('short', placed !== null && requested !== null && placed < requested)
    })
    for (const row of existing.values()) row.remove()
    legendList.hidden = draft.types.length === 0
  }

  /** The state the panel was drawn from; hovering a row changes none of it. */
  let shown: {
    draft: unknown
    derived: unknown
    result: unknown
    index: number
    optimize: unknown
  } | null = null

  function render(state: AppState): void {
    const next = {
      draft: state.draft,
      derived: state.derived,
      result: shownResult(state),
      index: shownContainer(state).index,
      optimize: state.optimize,
    }
    if (
      shown !== null &&
      shown.draft === next.draft &&
      shown.derived === next.derived &&
      shown.result === next.result &&
      shown.index === next.index &&
      shown.optimize === next.optimize
    ) {
      return
    }
    shown = next
    renderStatus(state)
    renderContainers(state)
    renderLegend(state)
  }

  return { render }
}
