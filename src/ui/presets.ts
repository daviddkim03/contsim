/**
 * Standard shipping containers. Interior dimensions are typical values for
 * ISO dry containers in millimetres; real boxes vary by an inch or so, and
 * door openings are smaller than the interior. Pick "Custom" for exact
 * numbers.
 */

import type { Dims } from '../core'
import { convertWeight, type Unit, type WeightUnit } from './units'

export type ContainerType = '20ft' | '40ft-hc' | 'custom'

export interface ContainerPreset {
  id: Exclude<ContainerType, 'custom'>
  name: string
  /** Interior length x width x height in millimetres. */
  mm: Dims
  /**
   * What one container is loaded to, in kilograms. Well under the ISO maximum
   * gross weight, because roads and railways rarely allow that much; Custom
   * size takes any figure.
   */
  payloadKg: number
}

export const CONTAINER_PRESETS: readonly ContainerPreset[] = [
  { id: '20ft', name: '20 ft', mm: { l: 5898, w: 2352, h: 2393 }, payloadKg: 11000 },
  { id: '40ft-hc', name: '40 ft high cube', mm: { l: 12032, w: 2352, h: 2698 }, payloadKg: 19000 },
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

/** The preset's payload in the chosen weight unit, as the string a draft holds. */
export function presetPayloadText(preset: ContainerPreset, unit: WeightUnit): string {
  return String(Math.round(convertWeight(preset.payloadKg, 'kg', unit)))
}
