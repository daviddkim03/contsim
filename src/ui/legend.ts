import { h, query, setText } from './dom'
import { summarizeStatus } from './describe'
import { shownContainer, shownResult, type AppState, type Store } from './state'
import type { Panel } from './sidebar'
import { formatNumber, formatVolume } from './units'

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
      </dl>
    </section>
    <section class="containers" hidden>
      <h2>Containers</h2>
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
  }
  const containersSection = query<HTMLElement>(root, '.containers')
  const containerList = query<HTMLElement>(root, '.container-list')
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
    } else {
      for (const el of Object.values(stats)) setText(el, '-')
    }
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
          ],
        )
      }),
    )
  }

  function renderLegend(state: AppState): void {
    const { draft, derived } = state
    const { scenario, scale } = derived
    const result = shownResult(state)
    const shown = shownContainer(state)
    const multi = (result?.containers.length ?? 0) > 1
    const rows = draft.types.map((type, index) => {
      const coreType = scenario?.types[index]
      const placed = result
        ? result.containers.reduce(
            (n, c) => n + c.placements.filter((p) => p.typeId === type.id).length,
            0,
          )
        : null
      const here = shown.packing?.placements.filter((p) => p.typeId === type.id).length ?? 0
      const requested = coreType?.qty ?? null
      const row = h('li', { class: 'legend-row', 'data-id': type.id })
      const swatch = h('span', { class: 'swatch' })
      swatch.style.background = type.color
      const dims = coreType
        ? `${formatNumber(coreType.dims.l, scale)} × ${formatNumber(coreType.dims.w, scale)} × ${formatNumber(coreType.dims.h, scale)} ${draft.unit}`
        : type.kind === 'catalog'
          ? type.catalogCode
            ? 'Not in the catalog'
            : 'No cabinet picked yet'
          : `${type.l || '?'} × ${type.w || '?'} × ${type.h || '?'} ${draft.unit}`
      const count =
        placed !== null && requested !== null ? `${placed} / ${requested}` : type.qty || '?'
      if (placed !== null && requested !== null && placed < requested) row.classList.add('short')
      const countEl = h('span', { class: 'legend-count' }, [h('span', { text: count })])
      if (multi && placed !== null) {
        countEl.append(
          h('span', { class: 'legend-here', text: `${here} in container ${shown.index + 1}` }),
        )
      }
      row.append(
        swatch,
        h('span', { class: 'legend-text' }, [
          h('span', { class: 'legend-name', text: coreType?.name ?? type.name ?? '' }),
          h('span', { class: 'legend-dims', text: dims }),
        ]),
        countEl,
      )
      return row
    })
    legendList.replaceChildren(...rows)
    legendList.hidden = rows.length === 0
  }

  return {
    render(state: AppState) {
      renderStatus(state)
      renderContainers(state)
      renderLegend(state)
    },
  }
}
