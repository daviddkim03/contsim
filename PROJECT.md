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

## Status

All six phases were built and verified on 2026-08-28: 116 unit tests, 14 Playwright tests against the production build, lint and typecheck green. Deployment is a static `dist/` folder (README.md). Deviations from the original plan are noted inline in the sections below.

Added on 2026-09-02: Export Excel (a dependency-free .xlsx writer, section 5.4) and a GitHub Actions workflow that runs the checks and deploys to GitHub Pages.

Added on 2026-09-03: container presets and a cabinet catalog with a searchable picker (section 5.5), and packing into as many containers as the order needs with automatic background optimization (sections 4.4 and 5.6). The Optimize button, its objectives and the Apply / Discard popover are gone; the optimizer's job is now to fill each container as densely as possible. Later the same day: Excel import of an order, with a template and a guide, replacing JSON import and export (section 5.7); the Excel export imports back.

Added on 2026-09-08: the import asks which unit the file's sizes are in and switching units converts every size (sections 2 and 5.7); a custom box can be saved into the catalog and taken back out (section 5.5); the shipped catalog is five placeholders instead of the 174 sample rows, since the real one is loaded from a spreadsheet or built up in the app. Then the 3D view was made to scale to a thousand boxes in a container (section 5.8).

Added on 2026-09-09: two loading modes, Even (the default, spreading the boxes so every container holds close to the same number) and Optimize (the previous behaviour), in sections 4.4 and 5.6; editable per-container counts in the legend (section 5.6); and weight, with a payload per container type and a weight per box (section 5.9).

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

Units: the core is unit-agnostic. The UI has a unit (in, ft, cm, mm, m) that every length is expressed in; changing it converts them all (`convertLength` in `src/ui/units.ts`), so a size always means the same measurement. Until 2026-09-08 the unit was only a label and typed numbers kept their value, which stopped making sense once catalog and preset sizes converted around them.

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

### 4.4 Many containers (`src/core/multi.ts`)

`packMany(container, types, opts)` fills containers of one size one after another: each container gets what the packer can place from what is left, and the remainder moves on to a fresh container, up to a cap (50). Every packable type fits in an empty container, so the loop always terminates with everything placed; a type that fits in no container in any allowed orientation is reported up front (`status: 'impossible'`, `impossibility: { kind: 'oversize' }`) and everything else is still packed.

Two modes decide how the load is spread, both deterministic.

- `mode: 'even'` (what the app opens with) spreads it. A first pass fills containers one at a time only to learn how many are needed; a second pass then hands each container `evenShare` of what is left: an equal slice of every type, whole boxes dealt out by largest remainder, so the containers end up with close to the same box count and the same mix. Anything a container cannot take rolls forward, so a tight fit shifts a few boxes later rather than failing. If the spread ends up needing more containers than plain filling did, the plain result is kept: an even load is not worth an extra container. It costs two passes, about twice a plain filling and far less than optimizing, so the UI runs it synchronously in `derive()` and there is nothing to wait for.
- `mode: 'optimize'` fills each container as full as it can before opening the next. With `optimizeRuns > 0` each container receives the largest-volume subset that `optimize()` (section 4.3, objective keep-most-volume) can fit within the remaining run and time budget, which is shared across containers; when either runs out, the rest fall back to a single first-fit run. `onProgress` reports runs and finished containers and can stop the optimizing early, still returning a complete packing.

In `optimize` mode the UI runs the plain variant synchronously in `derive()` (a few milliseconds) for instant feedback and the budgeted variant in a worker; `shownResult()` shows the worker's packing once it is in, unless it needs more containers or places fewer boxes, which greedy per-container filling can in principle do.

Measured on the example order (140 cabinets, 20 ft): plain filling gives 62 and 78 boxes at 87 % and 57 % fill in 3 ms, even gives 70 and 70 at 72 % each in 6 ms, and optimizing confirms the plain split in 35 ms. On 1,300 small boxes over three containers: plain 393 / 898 / 9, even 434 / 433 / 433.

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
- Clear, beside Import and + Add box, empties the box list after one confirmation; the container, units and settings stay for the next order. It is the only way out of a long list, since rows are otherwise removed one at a time.
- Status badge:
  - Fits (green): "All 24 boxes placed. Fill 71 %."
  - Doesn't fit (amber): "Placed 21 of 24. No arrangement found for the rest; it may still be possible. Try Optimize or reduce quantities."
  - Impossible (red): the reason from 4.1, for example "Total box volume 1,920 exceeds container volume 1,728" or "Box B (48 x 48 x 100) does not fit in the container in any orientation".
  - Fix inputs (grey): some field is invalid.
- 3D view: container as a wireframe over a light floor, boxes as solid colored cuboids with dark edges, one stable color per type. Hovering a legend row or a sidebar row highlights that type (everything else fades). The layer slider hides every box whose bottom is above the chosen height so the user can look inside. The camera follows the container until the user first orbits; after that it only moves on Reset view or when the container dims change. A 3D / Table toggle swaps the center panel for the placement list. Rendering is on demand, not a loop. Without WebGL the app falls back to the table.
- Unplaced boxes: shown in the legend as "7/10" and listed under the status.
- Optimize: automatic, see 5.6. (Until 2026-09-03 this was a button with three objectives and an Apply / Discard popover proposing quantity reductions; with overflow going to another container, reductions no longer make sense.)
- Persistence: the current scenario is saved to localStorage on every change. Export Excel downloads `contsim-packing.xlsx` (section 5.4) and Import reads it back, or reads an order sheet (section 5.7). "Load example" restores the sample scenario after a confirmation. (JSON import and export existed until 2026-09-03.)
- Validation: non-numeric, zero, negative, or absurdly large dims mark the field invalid; the packer does not run; status shows "Fix inputs". Never crash on bad input.

### 5.3 Style

Dark sidebar, light canvas background, amber primary button, muted secondary buttons, monospace for numbers. Plain CSS, no component library. Be picky: aligned inputs, consistent spacing, no layout jumps when the status changes.

### 5.4 Excel export

Export Excel writes what the screen shows, so a colleague without the app gets the whole picture. Three sheets, all numbers in the display unit and volumes in cu ft or m³:

- Summary: exported at, status and details (the same wording as the badge), unit, container dims and volume, keep upright, boxes requested / placed / left out, fill, placed volume, packing time, and a note explaining the placement coordinates. While an Optimize proposal is on screen the status is "Optimize proposal" and the optimizer's runs and time are listed.
- Boxes: one row per type: name, color, dims, requested, placed, left out, volume each, placed volume, share of the container.
- Placements: one row per placed box in placement order: box, x, y, z (min corner), oriented length, width, height, and top (z + height).

The writer is in-house (`src/ui/xlsx.ts` + `src/ui/zip.ts`, about 300 lines): SpreadsheetML with inline strings, a bold frozen header row, column widths, and a percent number format, packaged in a ZIP that deflates through the browser's CompressionStream (stored when unavailable). The available libraries were rejected on purpose: SheetJS on npm is stale with open advisories, and ExcelJS is larger than three.js. The subset of the format used here has not changed since 2006. Tests read the file back with an independent ZIP reader that checks every CRC with Node's zlib, and the e2e test downloads a real file from the production build.

### 5.5 Container presets and the cabinet catalog

The container is chosen from a dropdown of the two that are shipped in practice, 20 ft and 40 ft high cube, whose typical interior sizes are kept in millimetres (`src/ui/presets.ts`) and converted to the display unit with sensible decimals; the L / W / H fields and the payload show the numbers and are locked. "Custom size" unlocks them, starting from the preset's numbers, and the custom values survive switching back and forth. A saved scenario naming a container the app no longer offers keeps its boxes and falls back to Custom size, where the numbers are on screen to correct.

Box rows pick from the cabinet catalog. It has two parts (`src/ui/catalogStore.ts`): the built-in items (`data/catalog.xlsx` -> `npm run catalog` -> `src/catalog.ts`, W x D x H in inches; the app ships five placeholders) and the items the user saved, which live in localStorage under `contsim.catalog.v1`. Codes match regardless of case and spaces, and a saved code cannot shadow a built-in one.

The row's text input is a combobox (`src/ui/combobox.ts`): typing filters by code (exact, prefix, substring) or by size in the display unit or inches, sizes typed in W x D x H order rank first, saved items are marked "saved", and "Custom size" at the end of the list turns the row into a custom box named after the typed text with editable dimensions. Width runs along the container's length, depth along its width, height is up. Rows saved before the catalog existed load as custom boxes.

The star on a custom row saves it into the catalog under its name (converted to inches), which turns the row into a catalog row; the star on a saved cabinet takes it back out and returns every row using it to a custom box with the same size. A name that is taken, or a box without a size, is refused with a message.

### 5.6 Many containers, and the two loading modes

The status badge reads Fits (one container), "N containers" (blue), Impossible (a type that fits in no container; the rest is still packed and the badge's details say so), Too many (container cap), or Fix inputs. The side panel lists the containers with box counts and fill bars; clicking one, or the "Container 1 of N" switcher in the toolbar, selects what the 3D view shows. The legend shows placed / requested per type plus how many are in the selected container. The table lists every placement with its container number, and the Excel export gains a Containers sheet and a Container column.

A Loading panel in the sidebar switches between the two modes of section 4.4, with a line under it saying what the chosen one does:

- **Even** (the default): "Every container gets close to the same number of boxes." Computed in `derive()`, so the answer is on screen as soon as the inputs settle and no worker runs.
- **Optimize**: "Fills each container as full as it can, so the last one may be nearly empty." `derive()` shows first fit straight away and `src/ui/optimizeClient.ts` starts `packMany` in a Web Worker with a run and time budget, mirroring progress into the status panel ("Optimizing container fill... 120 / 400 runs"). Any edit terminates the worker; the next settled recompute starts a fresh one.

The mode is part of the scenario: it is saved with the draft, written to the Excel Summary sheet as "Loading mode", and read back on import (a workbook from before the modes loads as Even).

The legend counts the boxes of each type in the container on screen, and that count is an input. Lowering it leaves fewer for this container, so the rest move into the ones after it; raising it pulls them back, and the packer still only takes what fits, so a number the container cannot hold quietly settles at its capacity when the field is left. The counts live in `draft.allocation` together with the scenario shape they were typed for (`scenarioShape` in `src/ui/state.ts`): they survive quantity changes and reloads, and are ignored the moment the container, a box size, the unit or the mode changes. "Reset split" next to the container list hands the arrangement back to the mode. In `even` mode a hand-placed count wins over the rule that an even load is not worth an extra container, since the split is then the user's, not the app's.

### 5.7 Importing an order

Import (in the Boxes panel) accepts an .xlsx or .csv file. `src/ui/spreadsheet.ts` reads workbooks without a library: the ZIP is inflated with the browser's DecompressionStream, worksheets are parsed with regular expressions (shared strings, inline strings, formula results, booleans, errors), and CSV is split on the delimiter used in the first line with quoted fields. `src/ui/orderImport.ts` finds the header row (within the first 20 rows) by its column words, case, punctuation and units aside: Code (Type, Item, SKU, Name, Box), Qty (Quantity, Count, Pcs, Requested), Width / Depth / Height (W / D / H; Length and Width side by side mean first and second size, the app's own naming), and Color. Catalog codes are matched ignoring case and spaces and take their size from the catalog; other codes need all three sizes and become custom boxes; duplicate codes add up; every skipped row gets a one-line reason shown under the buttons. Sizes convert from the unit named in the header into the app's unit.

Before anything is applied, the file is parsed once to fill a dialog (`src/ui/importDialog.ts`) that shows what was found, how many rows will be skipped and what the import replaces, and asks which unit the file's sizes are in: a spreadsheet rarely says, and the answer changes what every number means. The chosen unit becomes the app's unit, so the numbers on screen match the numbers in the file. A column header that names its own unit keeps it, and a workbook saved by contsim states its unit in the Summary sheet, so it is not asked about. Confirming parses the file again in that unit and applies it.

A workbook with Boxes and Summary sheets is the app's own export: the Boxes sheet is read as an order (with colors) and the Summary sheet restores the container type or custom size, the unit and the upright setting, so Export Excel doubles as save-and-load. "Order template" downloads a workbook with the columns, three example rows and a Guide sheet listing the rules (`ORDER_FORMAT_GUIDE`, also in README.md). Importing over a non-empty list asks for confirmation.

### 5.8 Drawing a lot of boxes

A container can hold hundreds of boxes, and a mesh plus a wireframe per box means thousands of objects and draw calls, which is what made orbiting stutter. Each box type is drawn as one `InstancedMesh` over a shared unit cube (the instance matrix carries position and size) plus one `LineSegments` whose buffer holds every wireframe of that type (`writeBoxEdges` in `viewerMath.ts`). A container costs a couple of draw calls per type instead of two per box, and frustum culling is off because there is nothing left to cull.

Each type's boxes are sorted bottom-up when the packing is built, so the layer slider shows a prefix: moving it sets `mesh.count` and the edge draw range from a binary search (`visibleCount`), touching no buffers.

The panels also stopped re-rendering on view changes that do not concern them: the legend and the placements table remember what they were drawn from and skip identical states, and the table does not build while the 3D view covers it. It caps at 500 rows and says so, pointing at the export for the rest; thousands of rows cost more to build than anyone can read.

Finally the optimizer takes a wall-clock budget as well as a run count. A packer run costs a fraction of a millisecond for a few large boxes and tens of milliseconds for hundreds of small ones, so a run count alone let a dense order spend five seconds of a core on every edit.

### 5.9 Weight

A container runs out of payload as well as of space. Each preset carries the payload it is loaded to in kilograms (11,000 in a 20 ft box, 19,000 in a 40 ft high cube: well under the ISO maximum gross, because roads and railways rarely allow that much, which is also why Custom size takes any figure), and each box type can carry the weight of one box. The packer keeps a running total and passes over any box that would take the container past its payload, leaving it for the next one - a lighter box may still go in, so a skipped box does not close the container. A box heavier than a container can carry ships nowhere: that is an `overweight` impossibility, named in the status line, with the rest of the order still packed.

Weights reach the core as whole grams so they compare exactly, like lengths. The UI keeps them in kilograms or pounds (a second unit selector beside the length one, converting on a switch), takes them from the catalog when it has them (an optional `WEIGHT` column in `data/catalog.xlsx`), from a `Weight` column on import, or typed into the box row. A blank weight is unknown, which the packer treats as weightless; a payload of 0 means no limit, so an order without weights packs exactly as it did before weights existed. The status panel and each container in the list show the load against the payload, and the Excel export carries the weight unit, the payload, a weight per container with its share, and a weight per box type.

## 6. Tech stack

- TypeScript + Vite. Vanilla DOM for the UI: one `render(state)` function per panel, event delegation, a single immutable state object. If the UI grows, Preact or Svelte are fine; keep `src/core` framework-free either way.
- three.js for the 3D view (one InstancedMesh and one merged edge buffer per box type, see 5.8; OrbitControls from `three/addons/controls/OrbitControls.js`). The only runtime dependency.
- Vitest for unit tests of the core and the pure UI modules. Playwright (`npm run test:e2e`) drives the production build in Chromium; it was pulled forward from Phase 6 so every UI phase is verified in a real browser.
- ESLint + Prettier. `npm run lint` and `npm test` must stay green at every commit.
- Static deploy (GitHub Pages, Netlify, any static host). No backend, no database, no accounts. `.github/workflows/deploy.yml` runs lint, unit and e2e tests on every push and pull request and publishes to GitHub Pages from main, building with `--base /<repo>/`.
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
      multi.ts            as many containers as needed, evened out or optimized (4.4)
      ordering.ts         orderings + seeded PRNG
      index.ts
    catalog.ts            generated cabinet catalog (npm run catalog); do not edit
    scenarios.ts          synthetic scenarios (mixedScenario, exampleScenario) used by the core tests
    ui/
      state.ts            scenario state, reducers, validation, localStorage persistence
      units.ts            unit labels, integer scaling at the boundary, formatting
      dom.ts              tiny DOM helpers (h, setValue, setInvalid, download)
      describe.ts         status wording shared by the status panel and the report
      presets.ts          standard container interiors, payloads and unit conversion (5.5, 5.9)
      catalogStore.ts     built-in plus saved catalog items, persisted (5.5)
      catalogSearch.ts    catalog unit conversion and search ranking (5.5)
      combobox.ts         searchable dropdown used by the box rows (5.5)
      example.ts          the order the app opens with
      spreadsheet.ts      reads .xlsx (ZIP + SpreadsheetML) and .csv into rows (5.7)
      orderImport.ts      rows -> box rows, the export round trip, the order template (5.7)
      importDialog.ts     asks what the file holds and which unit it uses (5.7)
      palette.ts          box type colors
      sidebar.ts          container preset and size, box rows with the catalog picker, export
      legend.ts           status panel, container list (selector) and legend
      placementsTable.ts  placement list; the center panel until the 3D view exists
      stage.ts            center panel: toolbar (3D/Table, container toggle, layer slider, reset view)
      viewer3d.ts         three.js scene, on-demand rendering, hover dimming, layer visibility
      viewerMath.ts       pure helpers: core-to-scene mapping, layer predicate and prefix count, edge buffers, aspect-aware framing
      report.ts           the Excel report: Summary, Boxes and Placements sheets from the state
      xlsx.ts             minimal SpreadsheetML writer (typed cells, header style, percent format)
      zip.ts              minimal ZIP writer (CRC-32, deflate via CompressionStream or stored)
      optimizeWorker.ts   runs packMany() with a run budget off the main thread
      optimizeProtocol.ts request / progress / done / error message types
      optimizeClient.ts   watches the store and runs the worker whenever more than one container is needed
      palette.ts
    main.ts
  data/catalog.xlsx       the cabinet catalog (TYPE, W, D, H); five placeholders as shipped
  scripts/import-catalog.ts  regenerates src/catalog.ts from it
  scripts/make-placeholder-catalog.ts  writes the five-row starter spreadsheet back
  tests/
    core/                 geometry, feasibility, validate, ordering, packer, optimizer, multi tests
    ui/                   units and state tests
    e2e/                  Playwright smoke tests against the production build (npm run test:e2e)
    helpers/              independent ZIP and worksheet readers used to verify exports
    fixtures/             a workbook written by Excel, to test the reader against the real thing
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
- CLAUDE.md written by hand for the finished structure; README.md covers usage and deployment.

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
- Optimizer: bounded by both a run count and a wall-clock budget (DEFAULT_OPTIMIZE_MS), always in a worker.
- 3D view: 60 fps while orbiting a container holding a thousand boxes.
- Reacting to a view change (hover, layer, container): under a millisecond of work, whatever the box count.
- Initial load: < 300 KB gzipped (three.js is most of it).

Measured on 2026-09-08 with 900 boxes in one container, before and after section 5.8: orbiting 25 -> 119 fps, a layer-slider step 100 -> 0.3 ms, hovering a legend row 72 -> 0.1 ms, switching to the table with 2,000 placements 218 -> 55 ms, and the optimizer on a dense order 5.3 -> 1.8 s.

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
