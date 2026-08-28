import type { BoxType, Container, Scenario } from './core'

/** Approximate interior dims of standard dry containers, in inches. */
export const CONTAINERS: Record<'20ft' | '40ft' | '40ft-hc', Container> = {
  '20ft': { l: 232, w: 92, h: 94 },
  '40ft': { l: 474, w: 92, h: 94 },
  '40ft-hc': { l: 474, w: 92, h: 106 },
}

const boxType = (
  id: string,
  name: string,
  l: number,
  w: number,
  h: number,
  qty: number,
  color: string,
): BoxType => ({ id, name, dims: { l, w, h }, qty, color })

/** A 20 ft container with a realistic mix at roughly half its volume. Everything fits. */
export function mixedScenario(): Scenario {
  return {
    container: CONTAINERS['20ft'],
    keepUpright: false,
    types: [
      boxType('pallet', 'Pallet box', 48, 40, 48, 6, '#f59e0b'),
      boxType('crate', 'Long crate', 72, 20, 20, 3, '#3b82f6'),
      boxType('medium', 'Medium carton', 24, 18, 18, 20, '#10b981'),
      boxType('tote', 'Cube tote', 20, 20, 20, 10, '#8b5cf6'),
      boxType('small', 'Small carton', 16, 12, 12, 30, '#ef4444'),
    ],
  }
}

/**
 * The scenario the app opens with. Same mix as mixedScenario but with more of
 * everything, so it opens on "Doesn't fit" and Optimize has something to do.
 */
export function exampleScenario(): Scenario {
  const scenario = mixedScenario()
  const qty: Record<string, number> = { pallet: 12, crate: 6, medium: 40, tote: 20, small: 60 }
  return { ...scenario, types: scenario.types.map((t) => ({ ...t, qty: qty[t.id] ?? t.qty })) }
}
