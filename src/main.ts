import './style.css'
import { mountLegend } from './ui/legend'
import { mountStage } from './ui/stage'
import { createOptimizeController } from './ui/optimizeClient'
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
const optimizer = createOptimizeController(store)
const panels = [
  mountSidebar(query(app, '#sidebar'), store, optimizer),
  mountStage(query(app, '#stage'), store),
  mountLegend(query(app, '#side'), store),
]

store.subscribe((state) => panels.forEach((p) => p.render(state)))
panels.forEach((p) => p.render(store.get()))
