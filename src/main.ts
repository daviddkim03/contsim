import './style.css'
import { mountLegend } from './ui/legend'
import { mountPlacementsTable } from './ui/placementsTable'
import { mountSidebar } from './ui/sidebar'
import { Store, loadDraft } from './ui/state'
import { query } from './ui/dom'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app root element')

app.innerHTML = `
  <div class="app">
    <aside class="sidebar" id="sidebar"></aside>
    <main class="stage" id="stage"></main>
    <aside class="side" id="side"></aside>
  </div>
`

const storage = (() => {
  try {
    return window.localStorage
  } catch {
    return null
  }
})()

const store = new Store(loadDraft(storage), storage)
const panels = [
  mountSidebar(query(app, '#sidebar'), store),
  mountPlacementsTable(query(app, '#stage'), store),
  mountLegend(query(app, '#side'), store),
]

store.subscribe((state) => panels.forEach((p) => p.render(state)))
panels.forEach((p) => p.render(store.get()))
