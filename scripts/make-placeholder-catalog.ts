/**
 * Writes data/catalog.xlsx with a handful of placeholder cabinets.
 *
 *   node scripts/make-placeholder-catalog.ts && npm run catalog
 *
 * Only for starting over: the real catalog is whatever data/catalog.xlsx
 * holds, and `npm run catalog` turns it into src/catalog.ts.
 */

import { writeFileSync } from 'node:fs'
import { writeXlsx } from '../src/ui/xlsx.ts'

const TARGET = 'data/catalog.xlsx'

/** Code, then width, depth and height in inches. */
const rows = [
  ['18', 18, 24, 34.5],
  ['36', 36, 24, 34.5],
  ['3036', 30, 12, 36],
  ['2442', 24, 12, 42],
  ['P249624', 24, 24, 96],
]

writeFileSync(
  TARGET,
  await writeXlsx({
    sheets: [{ name: 'Catalog', header: ['TYPE', 'W', 'D', 'H'], rows, widths: [14, 8, 8, 8] }],
  }),
)
console.log(`Wrote ${TARGET} with ${rows.length} placeholder rows`)
