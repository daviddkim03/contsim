/**
 * Regenerates src/catalog.ts from data/catalog.xlsx.
 *
 *   npm run catalog
 *
 * The sheet has a header row (TYPE, W, D, H, then the same in millimetres)
 * and one cabinet per row. Only the code and the inch columns are used; the
 * app converts to other units itself. Codes must be unique and every
 * dimension positive, otherwise the script stops without writing.
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { readFirstSheet } from '../src/ui/spreadsheet.ts'

const SOURCE = 'data/catalog.xlsx'
const TARGET = 'src/catalog.ts'

const [header, ...rows] = await readFirstSheet(new Uint8Array(readFileSync(SOURCE)))

const expected = ['TYPE', 'W', 'D', 'H']
if (
  !header ||
  expected.some(
    (h, i) =>
      String(header[i] ?? '')
        .trim()
        .toUpperCase() !== h,
  )
) {
  throw new Error(`Expected the header ${expected.join(', ')}; found ${JSON.stringify(header)}`)
}

/** An optional weight column, in kilograms unless its header says pounds. */
const weightAt = header.findIndex((cell) => /^\s*(weight|wt|mass)\b/i.test(String(cell ?? '')))
const inPounds = weightAt >= 0 && /\b(lb|lbs|pound|pounds)\b/i.test(String(header[weightAt]))

interface Item {
  code: string
  w: number
  d: number
  h: number
  kg?: number
}

const items: Item[] = []
const seen = new Set<string>()
rows.forEach((row, i) => {
  const line = i + 2
  if (row.every((v) => v === undefined || v === '')) return
  const code = String(row[0] ?? '').trim()
  const [w, d, h] = [row[1], row[2], row[3]].map(Number)
  if (!code) throw new Error(`Row ${line}: empty code`)
  if (seen.has(code)) throw new Error(`Row ${line}: duplicate code ${code}`)
  for (const [label, v] of [
    ['W', w],
    ['D', d],
    ['H', h],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Row ${line} (${code}): ${label} is ${v}`)
  }
  seen.add(code)
  const raw = weightAt >= 0 ? Number(row[weightAt]) : NaN
  const kg =
    Number.isFinite(raw) && raw > 0
      ? Number((inPounds ? raw * 0.45359237 : raw).toFixed(3))
      : undefined
  items.push({ code, w: w!, d: d!, h: h!, ...(kg === undefined ? {} : { kg }) })
})
if (items.length === 0) throw new Error('No items found')

const lines = items.map(
  (it) =>
    `  { code: ${JSON.stringify(it.code)}, w: ${it.w}, d: ${it.d}, h: ${it.h}` +
    `${it.kg === undefined ? '' : `, kg: ${it.kg}`} },`,
)
writeFileSync(
  TARGET,
  `/**
 * Cabinet catalog: ${items.length} items generated from ${SOURCE} by
 * scripts/import-catalog.ts (npm run catalog). Do not edit by hand.
 */

export interface CatalogItem {
  /** The catalogue code, e.g. "3036" or "DB18(4)". */
  code: string
  /** Width, depth and height in inches. */
  w: number
  d: number
  h: number
  /** Weight of one cabinet in kilograms, when the catalog gives it. */
  kg?: number
}

export const CATALOG: readonly CatalogItem[] = [
${lines.join('\n')}
]
`,
)
execSync(`npx prettier --write ${TARGET}`, { stdio: 'inherit' })
console.log(`Wrote ${items.length} items to ${TARGET}`)
