import { describeImpossibility } from '../core'
import { h, query, setText } from './dom'
import type { AppState, Derived, Draft, Store } from './state'
import type { Panel } from './sidebar'
import { formatLength, formatNumber, formatVolume } from './units'

type Level = 'fits' | 'not-found' | 'impossible' | 'invalid'

const LABELS: Record<Level, string> = {
  fits: 'Fits',
  'not-found': "Doesn't fit",
  impossible: 'Impossible',
  invalid: 'Fix inputs',
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)} %`

/** Turns a validation path such as "types[1].dims.h" into "Box name H". */
function describeIssue(path: string, message: string, draft: Draft): string {
  const container = /^container\.(l|w|h)$/.exec(path)
  if (container) return `Container ${container[1]!.toUpperCase()}: ${message}`
  const type = /^types\[(\d+)\]\.(?:dims\.(l|w|h)|(qty)|(id))$/.exec(path)
  if (type) {
    const t = draft.types[Number(type[1])]
    const name = t?.name.trim() || `Box ${Number(type[1]) + 1}`
    const field = type[2] ? type[2].toUpperCase() : type[3] ? 'quantity' : 'id'
    return `${name} ${field}: ${message}`
  }
  return `${path}: ${message}`
}

export function mountLegend(root: HTMLElement, store: Store): Panel {
  root.innerHTML = `
    <section class="status" data-status="fits">
      <div class="badge"></div>
      <p class="message"></p>
      <ul class="details"></ul>
      <dl class="stats">
        <div><dt>Placed</dt><dd data-stat="placed"></dd></div>
        <div><dt>Fill</dt><dd data-stat="fill"></dd></div>
        <div class="wide"><dt>Volume</dt><dd data-stat="volume"></dd></div>
        <div><dt>Time</dt><dd data-stat="time"></dd></div>
      </dl>
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
  const stats = {
    placed: query<HTMLElement>(root, '[data-stat="placed"]'),
    fill: query<HTMLElement>(root, '[data-stat="fill"]'),
    volume: query<HTMLElement>(root, '[data-stat="volume"]'),
    time: query<HTMLElement>(root, '[data-stat="time"]'),
  }
  const legendList = query<HTMLUListElement>(root, '.legend-list')
  void store

  function renderStatus(draft: Draft, derived: Derived): void {
    const { result, scenario, scale, issues } = derived
    const unit = draft.unit
    const lines: string[] = []
    let level: Level
    let text: string

    if (!result || !scenario) {
      level = 'invalid'
      const entries = Object.entries(issues)
      text =
        entries.length === 1
          ? 'One field needs attention.'
          : `${entries.length} fields need attention.`
      for (const [path, msg] of entries.slice(0, 4)) lines.push(describeIssue(path, msg, draft))
    } else if (result.status === 'fits') {
      level = 'fits'
      text =
        result.stats.requested === 0
          ? 'Add a box type to get started.'
          : `All ${result.stats.requested} boxes placed.`
    } else if (result.status === 'not-found') {
      level = 'not-found'
      text = `Placed ${result.stats.placed} of ${result.stats.requested}. No arrangement found for the rest; it may still be possible. Try Optimize or reduce quantities.`
      for (const t of scenario.types) {
        const n = result.unplaced[t.id]
        if (n) lines.push(`${t.name}: ${n} left out`)
      }
    } else {
      level = 'impossible'
      text = describeImpossibility(result.impossibility!, scenario.types, {
        length: (n) => formatLength(n, scale, unit),
        volume: (n) => formatVolume(n, scale, unit),
      })
    }

    status.dataset.status = level
    status.classList.toggle('stale', derived.stale)
    setText(badge, LABELS[level])
    setText(message, text)
    details.replaceChildren(...lines.map((line) => h('li', { text: line })))
    details.hidden = lines.length === 0

    if (result) {
      setText(stats.placed, `${result.stats.placed} / ${result.stats.requested}`)
      setText(stats.fill, percent(result.stats.fill))
      const containerVolume = formatVolume(result.stats.containerVolume, scale, unit)
      const placedVolume = formatVolume(result.stats.placedVolume, scale, unit)
      const unitLabel = containerVolume.slice(containerVolume.indexOf(' '))
      setText(stats.volume, `${placedVolume.replace(unitLabel, '')} / ${containerVolume}`)
      setText(stats.time, `${result.stats.ms < 1 ? '<1' : Math.round(result.stats.ms)} ms`)
    } else {
      for (const el of Object.values(stats)) setText(el, '–'.replace('–', '-'))
    }
  }

  function renderLegend(draft: Draft, derived: Derived): void {
    const { result, scenario, scale } = derived
    const rows = draft.types.map((type, index) => {
      const coreType = scenario?.types[index]
      const placed = result ? result.placements.filter((p) => p.typeId === type.id).length : null
      const requested = coreType?.qty ?? null
      const row = h('li', { class: 'legend-row', 'data-id': type.id })
      const swatch = h('span', { class: 'swatch' })
      swatch.style.background = type.color
      const dims = coreType
        ? `${formatNumber(coreType.dims.l, scale)} × ${formatNumber(coreType.dims.w, scale)} × ${formatNumber(coreType.dims.h, scale)} ${draft.unit}`
        : `${type.l || '?'} × ${type.w || '?'} × ${type.h || '?'} ${draft.unit}`
      const count =
        placed !== null && requested !== null ? `${placed} / ${requested}` : type.qty || '?'
      if (placed !== null && requested !== null && placed < requested) row.classList.add('short')
      row.append(
        swatch,
        h('span', { class: 'legend-text' }, [
          h('span', { class: 'legend-name', text: coreType?.name ?? type.name ?? '' }),
          h('span', { class: 'legend-dims', text: dims }),
        ]),
        h('span', { class: 'legend-count', text: count }),
      )
      return row
    })
    legendList.replaceChildren(...rows)
    legendList.hidden = rows.length === 0
  }

  return {
    render({ draft, derived }: AppState) {
      renderStatus(draft, derived)
      renderLegend(draft, derived)
    },
  }
}
