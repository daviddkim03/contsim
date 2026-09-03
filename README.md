# contsim

A lightweight container packing simulator that runs entirely in the browser.

Pick a standard shipping container (or type a custom interior size), add cabinets from the catalog by code or size (or custom boxes) with quantities, and contsim packs them with a fast heuristic: it shows the load in 3D, opens as many containers as the order needs, and improves the fill in the background. Every edit updates the answer as you type.

## Features

- Container presets: 10 ft, 20 ft, 20 ft high cube, 40 ft, 40 ft high cube, 45 ft high cube (typical interior sizes, converted to the chosen unit), or a custom size.
- A searchable cabinet catalog (174 codes with width x depth x height) behind every box row: type a code or a size such as `30x12x36`, pick, set the quantity. "Custom size" turns a row into a box with typed dimensions.
- As many containers as it takes: what does not fit in the first container goes to the next one of the same type. The status reads **Fits**, **2 containers**, **Impossible** (a box that fits in no container in any orientation; the rest is still packed), or **Too many**.
- Automatic optimization: whenever a load needs more than one container, an optimizer runs in a Web Worker and fills each container with as much volume as it can, often saving a container. No button to press; the result replaces the first-fit packing when it is better.
- 3D view with orbit and zoom, a container switcher, a layer slider to look inside, hover highlighting per box type, and a table view of every placement in every container.
- Units: in, ft, cm, mm, m. Presets and catalog sizes convert; typed numbers keep their value. All math happens on exact integers.
- **Import** an order from Excel or CSV: one row per cabinet with a code and a quantity, sizes only for boxes outside the catalog. An order template with a guide sheet is one click away, and the Excel export imports back too, container settings included. The scenario also persists in the browser.
- **Export Excel** writes an .xlsx workbook with four sheets: a summary (status, container, totals), one row per container, one row per box type (requested, placed, left out, volumes), and one row per placed box (container, position, oriented size). Read and written by a small in-house reader and writer, no spreadsheet library.
- No backend, no accounts, one runtime dependency (three.js).

## Honesty about the algorithm

3D bin packing is NP-hard. contsim uses an extreme-point first-fit heuristic (a few milliseconds for hundreds of boxes) and fills containers one after another, so the container count is an upper bound: a cleverer arrangement might need one fewer. The background optimizer narrows that gap by trying several packing orders per container and adding boxes back greedily. `Impossible` is only ever claimed for a box that fits in no container in any allowed orientation, which is a proof. See PROJECT.md for the design.

## Importing an order

Click **Import** in the Boxes panel and pick an .xlsx or .csv file. **Order template** downloads a workbook with the columns, example rows and a Guide sheet. The rules:

1. One row per cabinet or box; the first row holds the column headers. Extra columns are ignored and blank rows are skipped.
2. `Code` (also accepted: Type, Item, SKU, Name, Box): the catalog code, for example `3036` or `DB18(4)`. Any other text makes a custom box named after it.
3. `Qty` (also accepted: Quantity, Count, Pcs, Requested): a whole number.
4. `Width`, `Depth`, `Height` (also accepted: W, D, H): only needed for boxes that are not in the catalog; ignored for catalog codes. Width runs along the container's length.
5. Units: put the unit in the header, for example `Width (mm)`. Without one, the unit selected in the app applies.
6. Rows with the same code are added together.
7. Files: .xlsx (the first sheet is read) or .csv (comma, semicolon or tab separated). A workbook saved with Export Excel is recognized too: its Boxes sheet restores the order and its Summary sheet the container, unit and upright setting.

Rows that cannot be used are listed under the buttons after the import, with the reason.

## The cabinet catalog

The catalog lives in `data/catalog.xlsx`: a header row `TYPE, W, D, H` (inches; further columns are ignored) and one cabinet per row. To change it, replace the file and run

```
npm run catalog
```

which regenerates `src/catalog.ts`. Codes must be unique and sizes positive; the script refuses anything else. Width runs along the container's length, depth along its width, height is up.

## Develop

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests against the production build (Playwright, Chromium)
npm run lint       # ESLint + Prettier
npm run build      # production build in dist/
npm run catalog    # regenerate src/catalog.ts from data/catalog.xlsx
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

- `src/core` - the algorithm: types, geometry, impossibility checks, packer, optimizer, and `multi.ts` (as many containers as needed). Pure functions, no DOM, no three.js (enforced by ESLint), fully unit tested.
- `src/ui` - state store, unit handling, container presets, catalog search and the picker (`combobox.ts`), sidebar, status and legend, 3D viewer, the background optimizer (`optimizeClient.ts` + worker), the Excel export (`report.ts` builds the workbook, `xlsx.ts` and `zip.ts` write the file) and the import (`spreadsheet.ts` reads .xlsx and .csv, `orderImport.ts` turns rows into boxes).
- `src/catalog.ts` - generated from `data/catalog.xlsx` by `scripts/import-catalog.ts`.
- `src/scenarios.ts` - synthetic scenarios used by the core tests; `src/ui/example.ts` is the order the app opens with.
- `tests/core`, `tests/ui` - Vitest suites; `tests/e2e` - Playwright.
- `PROJECT.md` - the specification and build plan this was built from.
