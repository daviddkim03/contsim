import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app root element')

app.innerHTML = `
  <main class="placeholder">
    <h1>contsim</h1>
    <p>Container packing simulator. Phase 0: project scaffold.</p>
  </main>
`
