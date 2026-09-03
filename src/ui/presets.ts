/**
 * Standard shipping containers. Interior dimensions are typical values for
 * ISO dry containers in millimetres; real boxes vary by an inch or so, and
 * door openings are smaller than the interior. Pick "Custom" for exact
 * numbers.
 */

import type { Dims } from '../core'
import type { Unit } from './units'

export type ContainerType = '10ft' | '20ft' | '20ft-hc' | '40ft' | '40ft-hc' | '45ft-hc' | 'custom'

export interface ContainerPreset {
  id: Exclude<ContainerType, 'custom'>
  name: string
  /** Interior length x width x height in millimetres. */
  mm: Dims
}

export const CONTAINER_PRESETS: readonly ContainerPreset[] = [
  { id: '10ft', name: '10 ft', mm: { l: 2831, w: 2352, h: 2393 } },
  { id: '20ft', name: '20 ft', mm: { l: 5898, w: 2352, h: 2393 } },
  { id: '20ft-hc', name: '20 ft high cube', mm: { l: 5898, w: 2352, h: 2698 } },
  { id: '40ft', name: '40 ft', mm: { l: 12032, w: 2352, h: 2393 } },
  { id: '40ft-hc', name: '40 ft high cube', mm: { l: 12032, w: 2352, h: 2698 } },
  { id: '45ft-hc', name: '45 ft high cube', mm: { l: 13556, w: 2352, h: 2698 } },
]

export const CONTAINER_TYPES: readonly ContainerType[] = [
  ...CONTAINER_PRESETS.map((p) => p.id),
  'custom',
]

export function presetFor(type: ContainerType): ContainerPreset | null {
  return CONTAINER_PRESETS.find((p) => p.id === type) ?? null
}

/** "20 ft high cube" for a preset, "custom" otherwise. */
export function containerTypeName(type: ContainerType): string {
  return presetFor(type)?.name ?? 'custom'
}

/** Millimetres per unit and the decimals worth keeping when converting a standard size. */
const UNIT_MM: Record<Unit, { perUnit: number; decimals: number }> = {
  mm: { perUnit: 1, decimals: 0 },
  cm: { perUnit: 10, decimals: 1 },
  m: { perUnit: 1000, decimals: 3 },
  in: { perUnit: 25.4, decimals: 1 },
  ft: { perUnit: 304.8, decimals: 2 },
}

export function mmToUnit(mm: number, unit: Unit): number {
  const { perUnit, decimals } = UNIT_MM[unit]
  return Number((mm / perUnit).toFixed(decimals))
}

export function presetDims(preset: ContainerPreset, unit: Unit): Dims {
  return {
    l: mmToUnit(preset.mm.l, unit),
    w: mmToUnit(preset.mm.w, unit),
    h: mmToUnit(preset.mm.h, unit),
  }
}

/** The preset's dimensions as the strings a draft holds. */
export function presetTexts(
  preset: ContainerPreset,
  unit: Unit,
): { l: string; w: string; h: string } {
  const d = presetDims(preset, unit)
  return { l: String(d.l), w: String(d.w), h: String(d.h) }
}
