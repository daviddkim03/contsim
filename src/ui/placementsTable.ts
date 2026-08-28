import { h, query, setText } from './dom'
import type { Panel } from './sidebar'
import { shownResult, type AppState, type Store } from './state'
import { formatNumber } from './units'

/** Plain list of placements: the alternative to the 3D view. */
export function mountPlacementsTable(root: HTMLElement, store: Store): Panel {
  void store
  root.innerHTML = `
    <section class="placements">
      <div class="panel-title">
        <h2>Placements</h2>
        <span class="hint" data-role="summary"></span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th class="num">#</th><th>Box</th><th class="num">x</th><th class="num">y</th><th class="num">z</th><th class="num">Size</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p class="empty hint">Placements will appear here once the inputs are valid.</p>
      </div>
    </section>
  `
  const summary = query<HTMLElement>(root, '[data-role="summary"]')
  const tbody = query<HTMLTableSectionElement>(root, 'tbody')
  const empty = query<HTMLElement>(root, '.empty')

  return {
    render(state: AppState) {
      const { draft, derived } = state
      const { scenario, scale } = derived
      const result = shownResult(state)
      if (!result || !scenario) {
        tbody.replaceChildren()
        empty.hidden = false
        setText(summary, '')
        return
      }
      const types = new Map(scenario.types.map((t) => [t.id, t]))
      const n = (v: number) => formatNumber(v, scale)
      const rows = result.placements.map((p, i) => {
        const type = types.get(p.typeId)
        const swatch = h('span', { class: 'swatch' })
        swatch.style.background = type?.color ?? '#888888'
        return h('tr', {}, [
          h('td', { class: 'num', text: String(i + 1) }),
          h('td', {}, [swatch, ' ', type?.name ?? p.typeId]),
          h('td', { class: 'num', text: n(p.x) }),
          h('td', { class: 'num', text: n(p.y) }),
          h('td', { class: 'num', text: n(p.z) }),
          h('td', { class: 'num', text: `${n(p.dx)} × ${n(p.dy)} × ${n(p.dz)}` }),
        ])
      })
      tbody.replaceChildren(...rows)
      empty.hidden = rows.length > 0
      setText(
        summary,
        rows.length > 0
          ? `${rows.length} placed, positions in ${draft.unit} from the back-bottom-left corner`
          : '',
      )
    },
  }
}
