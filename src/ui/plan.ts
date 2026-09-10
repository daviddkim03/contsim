/**
 * Flat views of a packed container, as a grid of coloured cells. A spreadsheet
 * has no drawing surface, so the picture is made of cells narrow enough to
 * read as pixels (see the Overview sheet in src/ui/report.ts).
 *
 * Core space: x = length, y = width (back to front), z = height.
 */

import type { Container, Placement } from '../core'

/** Colour per cell, row-major. null is empty container floor. */
export type Grid = (string | null)[][]

/** Columns a view is drawn across; the rows follow from the container's shape. */
export const PLAN_COLUMNS = 80

export interface Plan {
  grid: Grid
  columns: number
  rows: number
  /** Container units per cell, so a caller can say what the picture is worth. */
  cell: number
}

/** The cells an interval covers, clamped to the grid and never empty. */
function span(start: number, size: number, cell: number, cells: number): [number, number] {
  const from = Math.max(0, Math.min(cells - 1, Math.floor(start / cell)))
  const to = Math.max(from, Math.min(cells - 1, Math.ceil((start + size) / cell) - 1))
  return [from, to]
}

function blank(columns: number, rows: number): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null))
}

function paint(
  grid: Grid,
  [colFrom, colTo]: [number, number],
  [rowFrom, rowTo]: [number, number],
  colour: string,
): void {
  for (let r = rowFrom; r <= rowTo; r++) {
    for (let c = colFrom; c <= colTo; c++) grid[r]![c] = colour
  }
}

/**
 * Looking down: length across, width down the page. Boxes are painted lowest
 * first, so what you see is what is on top.
 */
export function topView(
  container: Container,
  placements: readonly Placement[],
  colourOf: (typeId: string) => string,
  columns = PLAN_COLUMNS,
): Plan {
  const cell = container.l / columns
  const rows = Math.max(1, Math.round(container.w / cell))
  const grid = blank(columns, rows)
  for (const p of [...placements].sort((a, b) => a.z - b.z)) {
    paint(grid, span(p.x, p.dx, cell, columns), span(p.y, p.dy, cell, rows), colourOf(p.typeId))
  }
  return { grid, columns, rows, cell }
}

/**
 * Looking in from the side: length across, height up the page. Boxes are
 * painted back first, so the near row is what you see.
 */
export function sideView(
  container: Container,
  placements: readonly Placement[],
  colourOf: (typeId: string) => string,
  columns = PLAN_COLUMNS,
): Plan {
  const cell = container.l / columns
  const rows = Math.max(1, Math.round(container.h / cell))
  const grid = blank(columns, rows)
  for (const p of [...placements].sort((a, b) => a.y - b.y)) {
    paint(
      grid,
      span(p.x, p.dx, cell, columns),
      // Row 0 is the container roof, so height is measured from the top down.
      span(container.h - p.z - p.dz, p.dz, cell, rows),
      colourOf(p.typeId),
    )
  }
  return { grid, columns, rows, cell }
}
