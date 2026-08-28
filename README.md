# contsim

A lightweight container packing simulator that runs entirely in the browser.

Enter the interior size of a container and a list of box types (length x width x height, quantity each). contsim packs them with a fast heuristic, shows the result in 3D, and tells you whether everything fits. When it does not, adjust quantities and watch the answer update as you type, or press **Optimize** to get the smallest set of reductions that makes everything fit.

## Features

- Live feedback on every edit: **Fits**, **Doesn't fit**, or **Impossible** with the reason (volume, an oversized box, or more of one box than can ever fit).
- 3D view with orbit and zoom, a layer slider to look inside, hover highlighting per box type, and a table view of every placement.
- Optimize with three objectives: keep the most boxes, keep the most volume, or cut every type by the same fraction. Runs in a Web Worker, previews the proposal in 3D, applies with one click.
- Units are labels only (in, ft, cm, mm, m); all math happens on exact integers.
- Scenarios persist in the browser and can be exported and imported as JSON.
- No backend, no accounts, one runtime dependency (three.js).

## Honesty about the algorithm

3D bin packing is NP-hard. contsim uses an extreme-point first-fit heuristic (a few milliseconds for hundreds of boxes) and reports three states: `fits` is a constructive proof, `impossible` is proven by cheap checks, and `not-found` means the heuristic came up short even though an arrangement might exist. It never claims impossibility it cannot prove. See PROJECT.md for the design.

## Develop

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests against the production build (Playwright, Chromium)
npm run lint       # ESLint + Prettier
npm run build      # production build in dist/
```

Node 22 (see .nvmrc). The first `npm run test:e2e` needs `npx playwright install chromium`.

## Deploy

`npm run build` produces a static site in `dist/`. Host it anywhere static files can be served: GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, or a plain web server. No environment variables, no server code. If the site is served from a sub-path, set `base` in `vite.config.ts` before building.

## Layout of the code

- `src/core` - the algorithm: types, geometry, impossibility checks, packer, optimizer. Pure functions, no DOM, no three.js (enforced by ESLint), fully unit tested.
- `src/ui` - state store, unit handling, sidebar, status and legend, 3D viewer, optimizer worker.
- `src/scenarios.ts` - standard container sizes and the example scenario.
- `tests/core`, `tests/ui` - Vitest suites; `tests/e2e` - Playwright.
- `PROJECT.md` - the specification and build plan this was built from.
