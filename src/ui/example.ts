import { catalogTexts } from './catalogSearch'
import { findCatalogItem } from './catalogStore'
import { PALETTE } from './palette'
import type { Draft } from './state'

/**
 * The order the app opens with: every cabinet in the placeholder catalog, in
 * quantities that overflow one 20 ft container, so the second container and
 * the background optimizer show up right away.
 */
const ORDER: [code: string, qty: number][] = [
  ['18', 28],
  ['36', 28],
  ['3036', 42],
  ['2442', 28],
  ['P249624', 14],
]

export function exampleDraft(): Draft {
  return {
    containerType: '20ft',
    mode: 'even',
    // The 20 ft preset in inches, so switching to Custom starts from a real container.
    container: { l: '232.2', w: '92.6', h: '94.2' },
    keepUpright: false,
    unit: 'in',
    types: ORDER.map(([code, qty], i) => {
      const item = findCatalogItem(code)
      if (!item) throw new Error(`Example cabinet ${code} is not in the catalog`)
      return {
        id: code.toLowerCase().replace(/[^a-z0-9]/g, ''),
        kind: 'catalog' as const,
        catalogCode: code,
        name: code,
        ...catalogTexts(item, 'in'),
        qty: String(qty),
        color: PALETTE[i % PALETTE.length]!,
      }
    }),
  }
}
