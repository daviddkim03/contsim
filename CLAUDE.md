# contsim

Container packing simulator: a static, browser-only app that checks whether boxes fit in a container, shows the packing in 3D, and proposes reductions when they do not. PROJECT.md is the spec and build plan; README.md is the user-facing overview.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test` (Vitest unit tests in `tests/core` and `tests/ui`), `npm run test:watch`
- `npm run test:e2e` (Playwright, drives the production build in Chromium; run `npx playwright install chromium` once)
- `npm run lint` (ESLint + Prettier check), `npm run format`, `npm run typecheck`

## Architecture

- `src/core`: pure algorithm code. No DOM, no three.js, no imports from `src/ui` (ESLint enforces this). Everything works on integer units; the UI scales real-world numbers at the boundary (`src/ui/units.ts`).
- `src/ui/state.ts`: single store. `draft` holds raw input strings, `derived` is computed by `derive()` (parse, scale, validate, pack), `view` and `optimize` are transient slices. Panels render from state and never keep their own copy.
- `src/ui/viewer3d.ts` renders on demand, not in a loop. Core x = length, y = width, z = height; the scene maps height to y and width to z (`viewerMath.ts`).
- Status semantics matter: `fits` is proven, `impossible` is proven, `not-found` means the heuristic failed. Never present a heuristic miss as impossibility.
- Status and objective wording lives in `src/ui/describe.ts` and is shared by the legend, the sidebar and the Excel report; do not duplicate it.
- Excel export: `src/ui/report.ts` turns the state into sheets, `src/ui/xlsx.ts` writes SpreadsheetML, `src/ui/zip.ts` writes the archive. All dependency-free; `tests/helpers/unzip.ts` reads the result back independently.
- Deploy: `.github/workflows/deploy.yml` runs the checks and publishes `dist/` to GitHub Pages on pushes to main, built with `--base /<repo>/`.

## Working rules

- Keep `npm test`, `npm run lint`, and `npm run test:e2e` green at every commit. Fix flakiness when it appears.
- Verify UI changes in the real app (screenshots via Playwright), not only in unit tests.
- Add a fixture to `tests/core/fixtures.ts` when reproducing a packing bug.
- No em dashes in prose or code comments; use "-".
