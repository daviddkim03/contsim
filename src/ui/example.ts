import { catalogTexts, findCatalogItem } from './catalogSearch'
import { PALETTE } from './palette'
import type { Draft } from './state'

/**
 * The order the app opens with: cabinets for about ten kitchens, enough to
 * overflow one 20 ft container so the second container and the background
 * optimizer show up right away.
 */
const ORDER: [code: string, qty: number][] = [
  ['36', 20],
  ['18', 20],
  ['DB18', 10],
  ['SB36', 10],
  ['BC36', 10],
  ['3036', 30],
  ['1830', 20],
  ['2442', 10],
  ['P249624', 10],
  ['VSB36', 10],
]

export function exampleDraft(): Draft {
  return {
    containerType: '20ft',
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
