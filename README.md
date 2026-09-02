# contsim

A lightweight container packing simulator that runs entirely in the browser.

Enter the interior size of a container and a list of box types (length x width x height, quantity each). contsim packs them with a fast heuristic, shows the result in 3D, and tells you whether everything fits. When it does not, adjust quantities and watch the answer update as you type, or press **Optimize** to get the smallest set of reductions that makes everything fit.

## Features

- Live feedback on every edit: **Fits**, **Doesn't fit**, or **Impossible** with the reason (volume, an oversized box, or more of one box than can ever fit).
- 3D view with orbit and zoom, a layer slider to look inside, hover highlighting per box type, and a table view of every placement.
- Optimize with three objectives: keep the most boxes, keep the most volume, or cut every type by the same fraction. Runs in a Web Worker, previews the proposal in 3D, applies with one click.
- Units are labels only (in, ft, cm, mm, m); all math happens on exact integers.
- Scenarios persist in the browser and can be exported and imported as JSON.
- **Export Excel** writes an .xlsx workbook with three sheets: a summary (status, container, totals), one row per box type (requested, placed, left out, volumes), and one row per placed box (position and oriented size). Exports the Optimize proposal while one is on screen. Written by a small in-house writer, no spreadsheet library.
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

`npm run build` produces a static site in `dist/`. There is no server code and nothing to configure, so any static host works: GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, or a plain web server.

### GitHub Pages (recommended)

The repository ships with `.github/workflows/deploy.yml`, which runs lint, unit and browser tests on every push and pull request, and publishes the build to GitHub Pages on every push to `main`.

1. Push the repository to GitHub.
2. In the repository settings open **Pages** and set **Build and deployment -> Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow from the Actions tab). The site appears at `https://<user>.github.io/<repo>/` after the first run.

The workflow builds with `--base /<repo>/` so assets resolve under the project path; a user site repository (`<user>.github.io`) is served from the root automatically.

### Any other static host

Build with the path the site will be served from, then upload `dist/`:

```
npm run build                         # served from the root, e.g. https://example.com/
npm run build -- --base /contsim/     # served from a sub-path, e.g. https://example.com/contsim/
```

## Layout of the code

- `src/core` - the algorithm: types, geometry, impossibility checks, packer, optimizer. Pure functions, no DOM, no three.js (enforced by ESLint), fully unit tested.
- `src/ui` - state store, unit handling, sidebar, status and legend, 3D viewer, optimizer worker, and the Excel export (`report.ts` builds the workbook, `xlsx.ts` and `zip.ts` write the file).
- `src/scenarios.ts` - standard container sizes and the example scenario.
- `tests/core`, `tests/ui` - Vitest suites; `tests/e2e` - Playwright.
- `PROJECT.md` - the specification and build plan this was built from.
