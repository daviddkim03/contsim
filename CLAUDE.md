# contsim

Container packing simulator: a static, browser-only app that packs an order of cabinets (from a catalog) into as many standard shipping containers as it takes, shows each container in 3D, optimizes the fill in the background, and exports the load plan to Excel. PROJECT.md is the spec and build plan; README.md is the user-facing overview.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test` (Vitest unit tests in `tests/core` and `tests/ui`), `npm run test:watch`
- `npm run test:e2e` (Playwright, drives the production build in Chromium; run `npx playwright install chromium` once)
- `npm run lint` (ESLint + Prettier check), `npm run format`, `npm run typecheck`
- `npm run catalog` regenerates `src/catalog.ts` from `data/catalog.xlsx` (never edit the generated file); `npm run catalog:placeholder` rewrites that spreadsheet with the five-row starter. Both run through vite-node, so they resolve imports the way the app does.

## Architecture

- `src/core`: pure algorithm code. No DOM, no three.js, no imports from `src/ui` (ESLint enforces this). Everything works on integer units; the UI scales real-world numbers at the boundary (`src/ui/units.ts`).
- `src/ui/state.ts`: single store. `draft` holds raw input strings (plus the container preset and, per row, the catalog code), `derived` is computed by `derive()` (parse, scale, validate, first-fit `packMany`), `view` and `optimize` are transient slices. Panels render from state and never keep their own copy. `shownResult()` picks the optimizer's packing over first fit once it is in and not worse; always render through it.
- `draft.allocation` holds counts the user typed into the legend, with the scenario shape they were set for (`scenarioShape`); `allocationOf()` returns them only while that shape still matches, so a changed container, box size, unit or mode drops them without any explicit clearing. `packMany` treats them as a cap on what a container is offered, so the packer's own limits still apply.
- Two loading modes live in `draft.mode`. 'even' spreads the boxes over the containers and is cheap enough to run inside `derive()`, so no worker is involved. 'optimize' fills each container as full as it can: `derive()` shows first fit and `src/ui/optimizeClient.ts` runs `packMany` in a worker (run and time budget) whenever more than one container is needed. Any edit discards the run. Default is 'even'.
- Weights reach the core as whole grams (`toGrams` in `src/ui/units.ts`), so they compare exactly like lengths; container payloads live in `presets.ts` as kilograms. A box with no weight counts as weightless, and a payload of 0 as no limit, so a scenario without weights packs exactly as it did before.
- Presets (`src/ui/presets.ts`) are kept in millimetres and the catalog in inches; both convert to the display unit at derive time. Typed numbers convert too, when the unit changes: `edits.setUnit` rewrites the container and every custom row through `convertLength` and recomputes catalog rows from the catalog. Units are not labels.
- The catalog is built-in items (`src/catalog.ts`, from `data/catalog.xlsx`) plus items the user saved from a custom row, which `src/ui/catalogStore.ts` keeps in localStorage. It is module state, so tests call `resetUserCatalog()`; `initCatalog(storage)` runs once in `main.ts` before the first derive.
- `src/ui/viewer3d.ts` renders on demand, not in a loop. Core x = length, y = width, z = height; the scene maps height to y and width to z (`viewerMath.ts`).
- Drawing scales by box type, not by box: one InstancedMesh over a shared unit cube plus one merged edge buffer per type, with each type's boxes sorted bottom-up so the layer slider is a draw-range change. Keep it that way; a mesh per box cost 25 fps at 900 boxes (PROJECT.md 5.8).
- A view change (hover, layer, container) must stay near-free at any box count: the legend and the table skip identical states, and the table does not build while hidden or beyond 500 rows.
- Fragility is per box type (`BoxType.fragile`), and it carries three rules at once: upright only, touching one of the container's four vertical walls, and nothing above it. Fragile boxes are ordered last so they land on top. There is no global "keep upright" any more.
- Status semantics matter. A single-container `PackResult`: `fits` is proven, `impossible` is proven, `not-found` means the heuristic failed. A `MultiPackResult`: `fits` means every box is in some container (the count is an upper bound), `impossible` means a type fits in no container in any orientation (the rest is still packed), `limit` means the container cap was hit. Never present a heuristic miss as impossibility.
- Status and objective wording lives in `src/ui/describe.ts` and is shared by the legend, the sidebar and the Excel report; do not duplicate it.
- Excel export: `src/ui/report.ts` turns the state into sheets, `src/ui/xlsx.ts` writes SpreadsheetML, `src/ui/zip.ts` writes the archive. All dependency-free; `tests/helpers/unzip.ts` reads the result back independently.
- Import: `src/ui/spreadsheet.ts` reads .xlsx (all sheets, shared strings) and .csv; `src/ui/orderImport.ts` maps rows to box rows and recognizes the app's own export (Boxes + Summary sheets restore the whole scenario). The file is parsed twice: once to fill the dialog (`src/ui/importDialog.ts`, which asks for the unit unless the file states one), then again in the unit chosen. There is no JSON import or export any more; `parseDraft` / `serializeDraft` only serve localStorage. The order format is documented once, in `ORDER_FORMAT_GUIDE`, and copied into README.md; keep them in step.
- Deploy: `.github/workflows/deploy.yml` runs the checks and publishes `dist/` to GitHub Pages on pushes to main, built with `--base /<repo>/`.

## Working rules

- Keep `npm test`, `npm run lint`, and `npm run test:e2e` green at every commit. Fix flakiness when it appears.
- Verify UI changes in the real app (screenshots via Playwright), not only in unit tests.
- Add a fixture to `tests/core/fixtures.ts` when reproducing a packing bug.
- No em dashes in prose or code comments; use "-".
