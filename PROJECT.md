# contsim - Container Packing Simulator

A lightweight, browser-based simulator that answers one question: **will these boxes fit in this container?**

The user defines a container (L x W x H) and a list of box types (l x w x h, quantity each). The app computes a packing, shows it in 3D, and reports whether everything fits. If it does not, the user can tweak quantities by hand and watch the result update live, or press **Optimize** to get the smallest set of quantity reductions that makes everything fit, with one-click Apply.

This file is both the spec and the build plan. Each phase in section 8 is written so it can be handed to Claude Code as-is ("implement Phase 2 of PROJECT.md").

## TL;DR - recommended path

1. Vite + TypeScript, vanilla DOM for the UI, three.js for the 3D view, Vitest for tests. No backend. Static deploy.
2. Keep the algorithm in `src/core` as pure, dependency-free functions. Integer math internally. Test it to death; it is the whole product.
3. Packer: extreme-point first-fit-decreasing (section 4.2). ~150 lines, milliseconds for hundreds of boxes, natural-looking layered packings.
4. Optimizer: run the packer with several orderings, keep the best feasible plan, then greedily add boxes back (section 4.3). Runs in a Web Worker.
5. Build in the order of section 8: scaffold -> core -> packer -> minimal UI -> 3D -> optimizer -> polish. One phase per commit, acceptance criteria before moving on.

## 1. Goals and non-goals

Goals (v1):

- Enter container dims; add, edit, remove box types with dims and quantity.
- Instant feedback on every change: Fits / Doesn't fit / Impossible, with counts and fill %.
- 3D visualization of the packing, colored by box type, with a layer slider to look inside.
- Optimize: when it doesn't fit, propose reduced quantities that do fit, removing as little as possible. Apply with one click.
- Deterministic: the same input always gives the same result.
- Lightweight: static site, no backend, one runtime dependency (three.js), the core algorithm is dependency-free and reusable.

Non-goals (v1) - deliberately out of scope to keep it small:

- Weight limits, stacking strength, center of gravity, fragile items.
- Loading order, door position, pallets.
- Multiple containers, or picking a container size automatically.
- Non-box shapes.
- Provably optimal packing. 3D bin packing is NP-hard; we use a fast heuristic and are honest in the UI when it cannot prove either way.

## 2. Definitions

- Container: axis-aligned cuboid with interior dims L (x), W (y), H (z). Origin at the back-bottom-left corner.
- Box type: name, dims l x w x h, quantity, color. "Cubish" means rectangular cuboid, not necessarily a cube.
- Orientation: one of the 6 axis-aligned rotations of a box (fewer when sides are equal). With "keep upright" on, only the 2 rotations around the vertical axis are allowed.
- Placement: a box instance at position (x, y, z) with oriented dims (dx, dy, dz). Boxes may touch but never overlap.
- Status:
  - `fits`: every requested box was placed. This is a constructive proof.
  - `impossible`: proven by a quick check (volume, oversize box, per-type upper bound). Comes with a reason.
  - `not-found`: the heuristic could not place everything. It might still be possible. The UI must say so.

Units: the core is unit-agnostic. The UI has a unit label (in, ft, cm, mm, m) that only affects labels and the volume readout.

Numeric precision: convert all dims to integers at the UI boundary (multiply by 10^p, where p = max number of decimals across all inputs, capped at 3). The core does integer math only, so comparisons are exact. This avoids the classic float bug where 0.1 + 0.2 pushes a box 1e-17 past the wall and the app says "doesn't fit". Positions and extents never exceed a container dimension, so they stay exact; volumes are only used for the volume check and the fill ratio, where float rounding is harmless. The core accepts dims up to 10^7 units and quantities up to 10,000 per type; `validateScenario` in `src/core/validate.ts` reports every issue it finds so the UI can flag each field.

Defaults (change if you disagree, but change them in one place):

| Setting            | Default                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| Rotations          | all 6 orientations allowed; "Keep upright" toggle restricts to 2        |
| Packing order      | volume descending                                                       |
| Candidate order    | z, then y, then x (fill layers bottom-up, back to front, left to right) |
| Placement rule     | first fit (best fit is a small later change, see 4.2)                   |
| Optimize objective | keep the most boxes                                                     |
| Units label        | in                                                                      |

## 3. Data model (`src/core/types.ts`)

```ts
// All dims are integers; see the precision note in section 2.
export interface Dims {
  l: number
  w: number
  h: number
}
export type Container = Dims

export interface BoxType {
  id: string
  name: string
  dims: Dims
  qty: number
  color: string
}

export interface Placement {
  typeId: string
  // min corner
  x: number
  y: number
  z: number
  // oriented dims
  dx: number
  dy: number
  dz: number
}

export type Status = 'fits' | 'not-found' | 'impossible'

/** Structured reason for an impossible scenario; the UI formats it in its own units. */
export type Impossibility =
  | { kind: 'oversize'; typeId: string }
  | { kind: 'volume'; boxVolume: number; containerVolume: number }
  | { kind: 'upper-bound'; typeId: string; qty: number; maxAlone: number }

export interface PackResult {
  status: Status
  impossibility?: Impossibility // set when status is impossible
  placements: Placement[]
  unplaced: Record<string, number> // typeId -> count not placed
  stats: {
    containerVolume: number
    placedVolume: number
    fill: number // placedVolume / containerVolume
    placed: number
    requested: number
    ms: number
  }
}

export type Ordering =
  | 'volume-desc'
  | 'volume-asc'
  | 'height-desc'
  | 'footprint-desc'
  | 'round-robin'
  | { shuffle: number } // seeded

export interface PackOptions {
  keepUpright: boolean // default false
  order: Ordering // default 'volume-desc'
}

export type Objective = 'keep-most-boxes' | 'keep-most-volume' | 'cut-evenly'

export interface OptimizeResult {
  kept: Record<string, number> // typeId -> quantity that fits
  removed: Record<string, number> // typeId -> requested - kept
  result: PackResult // the packing of the kept set, status 'fits'
  runs: number
  ms: number
}
```

## 4. Algorithms

### 4.1 Quick impossibility checks (`src/core/feasibility.ts`)

Run before packing. They are O(number of types) and give a definitive "Impossible" with a human-readable reason:

1. Oversize box. No allowed orientation of the box fits inside the container (`orientations` + `insideContainer`). With keepUpright only the two upright orientations count.
2. Volume. sum(qty_i * l_i * w_i * h_i) > L * W * H.
3. Per-type upper bound (lattice bound). Let s be the smallest side of the box (with keepUpright: min(l, w) horizontally and h vertically). No more than floor(L/s) * floor(W/s) * floor(H/s) boxes of that type can be inside the container at once, whatever else is packed with them: every placed box has an extent of at least s along each axis, so it contains a point of the lattice (i*s - 1, j*s - 1, k*s - 1), and two non-overlapping boxes cannot share a lattice point. If qty_i exceeds the bound the scenario is impossible. Do not use the best single-orientation grid count here: it is a lower bound on capacity, not an upper bound (four 3x2x1 boxes fit in 5x5x1 as a pinwheel while every grid holds only two).

If none fire, run the packer. Passing these checks proves nothing; only the packer can prove `fits`. The result is structured (`Impossibility`), and `describeImpossibility(imp, types, fmt)` turns it into a sentence; the UI passes formatters that undo the integer scaling.

### 4.2 Packer: extreme-point first-fit-decreasing (`src/core/packer.ts`)

A simplified version of the extreme-point heuristic (Crainic, Perboli, Tadei 2008). Fast, small, and it produces layered packings that look natural in 3D.

Idea: keep a list of candidate positions ("extreme points", EPs). Place boxes one at a time, largest first, at the first EP where the box fits in some orientation. Each placed box creates new EPs at its corners.

```
pack(container, types, opts):
  items    = expand(types)                 // one entry per physical box, each remembers its typeId
  sort items by opts.order                 // default: volume desc, then longest side desc, then type order (stable)
  placed   = []
  eps      = [(0, 0, 0)]
  unplaced = {}

  for item in items:
    sort eps by (z, y, x)                  // lowest first, then back, then left
    hit = null
    for ep in eps:
      for d in orientations(item.dims, opts.keepUpright):   // deduped: cube 1, two equal sides 3, else 6
        if insideContainer(ep, d) and not overlapsAny(ep, d, placed):
          hit = (ep, d); break
      if hit: break
    if not hit:
      unplaced[item.typeId] += 1; continue
    box = { ...item, ...hit }
    placed.push(box)
    eps.remove(hit.ep)
    eps.addAll(newExtremePoints(box, placed))
    eps = eps.filter(p -> p.x < L and p.y < W and p.z < H and not coveredByAny(p, placed))
    dedupe(eps)                            // key "x,y,z"

  return summarize(container, placed, unplaced)
```

Overlap test. Strict inequalities so touching faces are allowed:

```
overlaps(a, b) =
  a.x < b.x + b.dx and b.x < a.x + a.dx and
  a.y < b.y + b.dy and b.y < a.y + a.dy and
  a.z < b.z + b.dz and b.z < a.z + a.dz
```

Dead points. A point p is useless if some placed box b covers it with half-open intervals: `b.x <= p.x < b.x+b.dx` and the same for y and z. Any box placed at p would overlap b at p itself.

New extreme points for a box at (x, y, z) with dims (dx, dy, dz) - v1 version:

```
corners = [(x+dx, y, z), (x, y+dy, z), (x, y, z+dz)]
for p in corners:
  add p
  add (p.x, p.y, dropZ(p, placed))        // "gravity": the highest surface below the point

dropZ(p, placed):
  z = 0
  for b in placed:
    top = b.z + b.dz
    if top <= p.z and b.x <= p.x < b.x+b.dx and b.y <= p.y < b.y+b.dy:
      z = max(z, top)
  return z
```

Why the gravity drop: without it, a box placed beside a tall neighbor can only start at the neighbor's base height, and corner points can hover above gaps. Dropping a point onto whatever is under it lets boxes fill holes and sit on real surfaces.

Complexity: every placement scans the EP list and checks overlap against placed boxes. For a few hundred boxes this is a few milliseconds in JS. Target: 300 boxes in < 50 ms. If thousands of boxes are ever needed, bucket placed boxes by z-range or add a uniform grid. Do not do this until a measurement says so.

First fit vs best fit: the loop above takes the first valid (ep, orientation). A best-fit variant scores every valid candidate (for example minimize z+dz, then y+dy, then x+dx) and keeps the best. It is a small change to the selection loop; try it once v1 works and keep whichever gives higher fill on the fixtures.

Known limitation: first-fit-decreasing can fail on arrangements that need a specific interlocking pattern (see the `pinwheel` fixture in section 9). That is why the status is `not-found`, never "impossible", when the packer comes up short.

v2 improvements, only if fill % on real scenarios is disappointing:

- Full extreme-point projection: project each corner point along the other two axes onto the nearest placed box face or container wall (as in the original paper). Lets boxes tuck into side gaps. Same data structures, ~40 more lines.
- Support rule: a box may only be placed at z = 0 or where at least S% (say 70%) of its footprint rests on box tops at exactly that height. Prevents "floating" boxes that could not physically be loaded. The gravity drop already avoids most of these.

### 4.3 Optimizer: fit as much as possible (`src/core/optimizer.ts`)

Problem: the requested quantities q_i do not fit. Find kept quantities k_i <= q_i that do fit, removing as little as possible.

Objective (user-selectable, first is the default):

- `keep-most-boxes`: maximize sum(k_i). Tie-break: maximize kept volume, then fewest types touched.
- `keep-most-volume`: maximize kept volume. Tie-break: sum(k_i).
- `cut-evenly`: every type reduced by the same fraction f, k_i = floor(f * q_i), largest feasible f.

Key insight: every packer run already yields a feasible reduced plan - the boxes it managed to place. So the optimizer is "run the packer several ways, keep the best plan, then greedily add boxes back":

```
optimize(container, types, opts, objective):
  r = pack(container, types, opts)
  if r.status == 'fits': return noReductions(r)

  orderings = [volume-desc, volume-asc, round-robin, height-desc, footprint-desc, shuffle(1) .. shuffle(5)]
  best = null
  for order in orderings:
    plan = planFromPlaced(pack(container, types, { ...opts, order }))   // k_i = placed count of type i
    if better(plan, best, objective): best = plan

  // greedy add-back: return one removed box at a time while it still fits
  repeat until a full pass changes nothing:
    for t in types, ordered by objective (keep-most-boxes: smallest boxes first; keep-most-volume: largest first):
      if best.k[t] < q[t]:
        trial = best.k with k[t] + 1
        r = pack(container, withQty(types, trial), opts)      // try 2-3 orderings before giving up on this trial
        if r.status == 'fits': best = planFrom(r)

  return { kept: best.k, removed: q - best.k, result: best.pack }
```

`cut-evenly`: binary search on f in [0, 1] (about 20 iterations, or stop when the integer quantities stop changing) using pack() as the oracle, then run the same add-back.

Notes:

- `round-robin` ordering: sort types by volume desc, then emit one box of each type per round. Every type gets a share of the space early; this is what makes "fair" reductions fall out of the packer naturally.
- Seeded shuffles use a tiny PRNG (mulberry32) with fixed seeds, so results are deterministic.
- Budget: cap at ~200 packer runs or ~3 s, whichever comes first. Report progress. Always run in a Web Worker so the UI never freezes; support cancel.
- The result is a proposal. The UI shows per-type reductions ("Box B: 10 -> 7") with Apply / Discard. Apply writes the quantities into the box list, which triggers the normal live recompute.

## 5. UI

### 5.1 Layout

The takeoff-tool screenshot is the layout and style reference: dark left sidebar holding the controls and a list, a large light canvas in the middle, a legend column on the right, floating view controls at the top-left of the canvas, an amber primary action pinned to the bottom of the sidebar, and a bottom-left result popover with Apply / Discard.

```
+-------------------+------------------------------------------------+---------------+
| CONTAINER         |  [Hide container] [Layer: all v] [Units: in v] |  LEGEND       |
|  L [    ] W [    ]|                                                |  # Box A 10/10|
|  H [    ]         |                                                |  # Box B  7/10|
|                   |                                                |  # Box C  4/4 |
| BOXES       + Add |             3D view (orbit / zoom)             |               |
|  Box A  l w h qty |                                                |  STATUS       |
|  Box B  l w h qty |                                                |  Doesn't fit  |
|  Box C  l w h qty |                                                |  21/24 placed |
|                   |                                                |  Fill 71 %    |
| [ ] Keep upright  |  +------------------------------+              |  12 ms        |
|                   |  | Optimize result              |              |               |
| [   Optimize    ] |  | Box B 10 -> 7, Box C 4 -> 3  |              |               |
| results update    |  | [Apply]  [Discard]           |              |               |
|   as you type     |  +------------------------------+              |               |
+-------------------+------------------------------------------------+---------------+
```

### 5.2 Behaviour

- Every edit (container dims, box dims, qty, upright toggle) re-runs the checks and the packer, debounced ~150 ms. There is no "Check" button; the status is always current. The unit selector sits next to the container dims in the sidebar rather than above the canvas.
- Qty has - / + steppers and accepts typing; arrow keys step. Minimum 0. A type with qty 0 stays in the list, greyed out.
- Status badge:
  - Fits (green): "All 24 boxes placed. Fill 71 %."
  - Doesn't fit (amber): "Placed 21 of 24. No arrangement found for the rest; it may still be possible. Try Optimize or reduce quantities."
  - Impossible (red): the reason from 4.1, for example "Total box volume 1,920 exceeds container volume 1,728" or "Box B (48 x 48 x 100) does not fit in the container in any orientation".
  - Fix inputs (grey): some field is invalid.
- 3D view: container as a wireframe over a light floor, boxes as solid colored cuboids with dark edges, one stable color per type. Hovering a legend row or a sidebar row highlights that type (everything else fades). The layer slider hides every box whose bottom is above the chosen height so the user can look inside. The camera follows the container until the user first orbits; after that it only moves on Reset view or when the container dims change. A 3D / Table toggle swaps the center panel for the placement list. Rendering is on demand, not a loop. Without WebGL the app falls back to the table.
- Unplaced boxes: shown in the legend as "7/10" and listed under the status.
- Optimize: runs in a Web Worker; the button shows progress ("Optimizing 34 / 200") and a Cancel button appears (cancel terminates the worker). The result popover (bottom-left of the stage) lists per-type reductions ("40 -> 25") with Apply / Discard, and the 3D view and table preview the proposed packing until the user decides. Any edit discards a pending proposal. An objective dropdown sits next to the button (default keep-most-boxes). Measured on the example: keep-most-boxes removes 2 pallet boxes and keeps 136 of 138, in well under a second.
- Persistence: the current scenario is saved to localStorage on every change. Export / Import JSON. "Load example" restores the sample scenario.
- Validation: non-numeric, zero, negative, or absurdly large dims mark the field invalid; the packer does not run; status shows "Fix inputs". Never crash on bad input.

### 5.3 Style

Dark sidebar, light canvas background, amber primary button, muted secondary buttons, monospace for numbers. Plain CSS, no component library. Be picky: aligned inputs, consistent spacing, no layout jumps when the status changes.

## 6. Tech stack

- TypeScript + Vite. Vanilla DOM for the UI: one `render(state)` function per panel, event delegation, a single immutable state object. If the UI grows, Preact or Svelte are fine; keep `src/core` framework-free either way.
- three.js for the 3D view (BoxGeometry + EdgesGeometry per box, InstancedMesh only if it ever gets slow; OrbitControls from `three/addons/controls/OrbitControls.js`). The only runtime dependency.
- Vitest for unit tests of the core and the pure UI modules. Playwright (`npm run test:e2e`) drives the production build in Chromium; it was pulled forward from Phase 6 so every UI phase is verified in a real browser.
- ESLint + Prettier. `npm run lint` and `npm test` must stay green at every commit.
- Static deploy (GitHub Pages, Netlify, any static host). No backend, no database, no accounts.
- Worker: `new Worker(new URL('./optimizeWorker.ts', import.meta.url), { type: 'module' })`; Vite bundles it.

Zero-dependency alternative for rendering: an isometric 2D canvas (each cuboid is three parallelograms, painter's sort by x+y+z). Only worth it if "no dependencies at all" is a hard requirement; three.js gives orbit and zoom for free and is the better experience.

## 7. Project structure

```
contsim/
  PROJECT.md              this file
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/
    core/                 pure functions, no DOM, no three.js - fully unit tested
      types.ts
      geometry.ts         orientations(), overlaps(), covered(), volume()
      feasibility.ts      quick impossibility checks (4.1)
      validate.ts         structural validation (MAX_DIM, MAX_QTY), reports every issue
      packer.ts           extreme-point packer (4.2)
      optimizer.ts        multi-start + add-back (4.3)
      ordering.ts         orderings + seeded PRNG
      index.ts
    scenarios.ts          standard containers, mixedScenario() and exampleScenario(); used by tests and "Load example"
    ui/
      state.ts            scenario state, reducers, validation, localStorage, JSON import/export
      units.ts            unit labels, integer scaling at the boundary, formatting
      dom.ts              tiny DOM helpers (h, setValue, setInvalid)
      palette.ts          box type colors
      sidebar.ts          container inputs, box list, options, Optimize button
      legend.ts           status panel + legend
      placementsTable.ts  placement list; the center panel until the 3D view exists
      stage.ts            center panel: toolbar (3D/Table, container toggle, layer slider, reset view)
      viewer3d.ts         three.js scene, on-demand rendering, hover dimming, layer visibility
      viewerMath.ts       pure helpers: core-to-scene mapping, layer predicate, aspect-aware framing
      optimizeWorker.ts   runs optimize() off the main thread
      optimizeProtocol.ts request / progress / done / error message types
      optimizeClient.ts   spawns the worker, mirrors progress into the store, cancel = terminate
      palette.ts
    main.ts
  tests/
    core/                 geometry, feasibility, validate, ordering, packer, optimizer tests
    ui/                   units and state tests
    e2e/                  Playwright smoke tests against the production build (npm run test:e2e)
    core/fixtures.ts      synthetic scenarios (tiny, rotation, pinwheel, perf300) and packingViolation()
```

Rule: `src/core` must never import from `src/ui` or from three.js. This keeps the algorithm testable in milliseconds and reusable (CLI, Node, a different UI).

## 8. Build plan

Do the phases in order. Each has acceptance criteria; do not start the next until they pass. One phase = one commit (or PR).

### Phase 0 - Scaffold

- `npm create vite@latest . -- --template vanilla-ts` (pick "Ignore files and continue" so PROJECT.md is kept), then `npm i three` and `npm i -D vitest @types/three eslint prettier typescript-eslint`.
- Scripts: dev, build, preview, test, lint, format.
- Accept: `npm run dev` serves a page; `npm test` runs an (empty) suite; `npm run lint` and `npm run build` pass.

### Phase 1 - Core geometry and feasibility

- `types.ts`, `geometry.ts` (orientations with dedupe and keepUpright, overlaps, covered, volume), `feasibility.ts` (the three checks, structured reasons, `describeImpossibility`), `validate.ts` (structural validation).
- Accept (tests): orientation counts (cube 1, two equal sides 3, otherwise 6; upright 2 or 1); overlap is symmetric and touching faces do not overlap; each impossibility check fires on a crafted case and stays quiet on a fitting case.

### Phase 2 - Packer

- `packer.ts` + `ordering.ts` as in 4.2.
- Accept (tests):
  - `tiny`: 8 unit cubes in 2x2x2, and 27 in 3x3x3: all placed, fill 100 %.
  - `rotation`: a 10x1x1 box in a 1x1x10 container is placed; with keepUpright the result is `impossible` (oversize).
  - `mixed-20ft`: a realistic mix at about 50 % of container volume: all placed.
  - `pinwheel`: status is `not-found` (documents the known limitation; must not be `impossible`).
  - Invariants on 200 random scenarios: no two placements overlap; every placement is inside the container; placed + unplaced equals requested per type; the same input twice gives identical output.
  - Performance: 300 boxes packed in < 50 ms locally (assert < 200 ms in the test to avoid flakiness).

### Phase 3 - Minimal UI

- `state.ts`, `units.ts`, `sidebar.ts`, `legend.ts`, `main.ts`. No 3D yet: render the status, counts, fill %, and a plain list of placements.
- Live recompute with debounce; validation; localStorage persistence; "Load example".
- Accept: open the app, edit quantities, watch the status change live; reload keeps the scenario; invalid input is flagged and nothing crashes.

### Phase 4 - 3D viewer

- `viewer3d.ts`: container wireframe, colored boxes with edges, orbit controls, layer slider, legend hover highlight, camera persists across recomputes, resize handling.
- Accept: a packing of 100+ boxes renders at 60 fps; the layer slider hides boxes above the chosen height; colors match the legend; the page looks right at 1280x800 and 1920x1080 with no horizontal scroll.

### Phase 5 - Optimizer

- `optimizer.ts` (all three objectives), `optimizeWorker.ts`, result popover with Apply / Discard, progress and cancel.
- Accept (tests): on a fixture where everything fits, optimize returns no reductions; on an over-full fixture the returned plan has status `fits` and keeps at least as many boxes as plain volume-desc packing; `cut-evenly` returns the largest f that fits; results are deterministic. UI: Optimize on the example finishes in < 3 s and Apply turns the status green.

### Phase 6 - Polish and ship

- JSON import / export, units dropdown, keyboard steppers, empty and error states, responsive layout (sidebar collapses under 900 px), title and favicon.
- One Playwright smoke test: load example -> bump a qty -> see "Doesn't fit" -> Optimize -> Apply -> see "Fits".
- `npm run build`, deploy `dist/` to a static host.
- Run `/init` in Claude Code to generate a CLAUDE.md from the finished structure.

## 9. Test fixtures (`tests/core/fixtures.ts` and `src/scenarios.ts`)

- `tiny`: 2x2x2 container, 8 x (1x1x1).
- `rotation`: 1x1x10 container, 1 x (10x1x1).
- `overfull`: 4x4x4 container, 70 x (1x1x1). Volume 70 > 64, expect `impossible` with the volume reason.
- `oversize`: 10x10x10 container, 1 x (11x1x1). Expect `impossible` with the oversize reason.
- `pinwheel`: 5x5x1 container, 4 x (3x2x1) + 1 x (1x1x1). Volume is exactly 25 and a pinwheel arrangement fits, but first-fit-decreasing cannot find it. Expect `not-found`.
- `mixedScenario()`: container-20ft with 5 box types at about 47 % of the volume. Expect `fits` (measured: fits with volume-desc, height-desc, footprint-desc, round-robin and the seeded shuffles; volume-asc leaves 2 pallet boxes out, which is why it is only used by the optimizer).
- `exampleScenario()`: the same mix with roughly double the quantities (94 % of the volume), so the app opens on "Doesn't fit" and Optimize has something to do. Measured: volume-desc places 123 of 138 boxes at 88 % fill in about 2 ms.

Approximate interior dims of standard dry containers, in inches (good enough for the example; make them editable):

- 20 ft: 232 x 92 x 94
- 40 ft: 474 x 92 x 94
- 40 ft high cube: 474 x 92 x 106

## 10. Performance targets

- Packer: <= 50 ms for 300 boxes, <= 500 ms for 2,000 boxes on a laptop.
- Live recompute: 150 ms debounce, result on screen within 100 ms after that.
- Optimizer: <= 3 s on the example scenario, always in a worker, always cancellable.
- Initial load: < 300 KB gzipped (three.js is most of it).

## 11. Later ideas (v2, only if wanted)

- Support rule (no floating boxes), per-type "this side up" and "max N stacked".
- Weight limit and center-of-gravity readout.
- Full extreme-point projection and best-fit scoring for higher fill.
- Multiple containers, or "pick the smallest standard container that fits".
- Feet-inches input (12'-6"), imperial / metric conversion.
- Share a scenario via URL hash; PNG export of the 3D view.
- CLI (`npx contsim scenario.json`) reusing `src/core` unchanged.

## 12. Working on this with Claude Code

- Hand over one phase at a time: "Implement Phase 2 of PROJECT.md. Write the tests first, then make them pass. Do not touch src/ui."
- After every UI phase, have it run the app (`/run`) and check the result in the browser, not just the tests. Be picky about alignment and spacing.
- Keep `npm test` and `npm run lint` green at every commit. Fix flaky tests when they appear, not later.
- If the fill % looks poor on a real scenario, that is the trigger for the v2 projection or best-fit scoring. Measure fill on the fixtures before and after.
- When a bug shows up, reproduce it in the browser with the exact scenario (export JSON, add it as a fixture) before fixing.

## 13. References

- Crainic, Perboli, Tadei (2008). "Extreme Point-Based Heuristics for Three-Dimensional Bin Packing." INFORMS Journal on Computing 20(3). The extreme-point idea used in 4.2.
- Dube, Kanavathy (2006). "Optimizing Three-Dimensional Bin Packing Through Simulation." The simple pivot-point packer that small libraries such as py3dbp implement; a good sanity comparison.
- Martello, Pisinger, Vigo (2000). "The Three-Dimensional Bin Packing Problem." Operations Research 48(2). Background on why exact methods are out of scope.
