/**
 * Human-readable descriptions of the current state, shared by the status
 * panel and the Excel report so they never disagree.
 */

import { describeImpossibility, type MultiPackResult } from '../core'
import { presetFor } from './presets'
import type { Derived, Draft } from './state'
import { formatLength, formatVolume, formatWeight } from './units'

export type Level = 'fits' | 'multi' | 'impossible' | 'limit' | 'invalid'

export interface StatusSummary {
  level: Level
  /** Badge text: "Fits", "3 containers", "Impossible", ... */
  label: string
  /** One sentence for the badge's message line. */
  text: string
  /** Extra lines: the fields to fix, the box types left out, or a note about the rest. */
  lines: string[]
}

/** Turns a validation path such as "types[1].dims.h" into "Box name H". */
export function describeIssue(path: string, message: string, draft: Draft): string {
  const container = /^container\.(l|w|h)$/.exec(path)
  if (container) return `Container ${container[1]!.toUpperCase()}: ${message}`
  const type = /^types\[(\d+)\]\.(?:dims\.(l|w|h)|(qty)|(id)|(catalog))$/.exec(path)
  if (type) {
    const t = draft.types[Number(type[1])]
    const name = t?.name.trim() || `Box ${Number(type[1]) + 1}`
    if (type[5]) return `${name}: ${message}`
    const field = type[2] ? type[2].toUpperCase() : type[3] ? 'quantity' : 'id'
    return `${name} ${field}: ${message}`
  }
  return `${path}: ${message}`
}

const boxes = (n: number) => `${n} ${n === 1 ? 'box' : 'boxes'}`
/** Box types listed one per line before the rest is summarized. */
const MAX_LISTED_TYPES = 5

/** "one 20 ft container", "3 × 20 ft containers", "2 containers". */
export function describeContainers(draft: Draft, n: number): string {
  const preset = presetFor(draft.containerType)
  if (n === 1) return preset ? `one ${preset.name} container` : 'one container'
  return preset ? `${n} × ${preset.name} containers` : `${n} containers`
}

/** Describes `result`, which defaults to the first-fit packing; pass the shown one for the panel. */
export function summarizeStatus(
  draft: Draft,
  derived: Derived,
  result: MultiPackResult | null = derived.result,
): StatusSummary {
  const { scenario, scale, issues } = derived
  const lines: string[] = []

  if (!result || !scenario) {
    const entries = Object.entries(issues)
    for (const [path, msg] of entries.slice(0, 4)) lines.push(describeIssue(path, msg, draft))
    return {
      level: 'invalid',
      label: 'Fix inputs',
      text:
        entries.length === 1
          ? 'One field needs attention.'
          : `${entries.length} fields need attention.`,
      lines,
    }
  }

  const { requested, placed, containers } = result.stats
  if (result.status === 'impossible') {
    const oversize = scenario.types.filter((t) => result.unplaced[t.id])
    for (const t of oversize.slice(0, MAX_LISTED_TYPES)) {
      lines.push(`${t.name}: ${boxes(result.unplaced[t.id]!)} cannot ship in this container`)
    }
    const rest = oversize.length - MAX_LISTED_TYPES
    if (rest > 0) lines.push(`and ${rest} more box ${rest === 1 ? 'type' : 'types'}`)
    if (placed > 0) {
      lines.push(`Everything else fits in ${describeContainers(draft, containers)}.`)
    }
    return {
      level: 'impossible',
      label: 'Impossible',
      text: describeImpossibility(result.impossibility!, scenario.types, {
        length: (n) => formatLength(n, scale, draft.unit),
        volume: (n) => formatVolume(n, scale, draft.unit),
        weight: (n) => formatWeight(n, draft.weightUnit),
      }),
      lines,
    }
  }
  if (result.status === 'limit') {
    return {
      level: 'limit',
      label: 'Too many',
      text: `Needs more than ${containers} containers. Showing the first ${containers}, holding ${placed} of ${requested} boxes.`,
      lines,
    }
  }
  if (requested === 0) {
    return { level: 'fits', label: 'Fits', text: 'Add a cabinet to get started.', lines }
  }
  if (containers <= 1) {
    return {
      level: 'fits',
      label: 'Fits',
      text: `All ${boxes(requested)} placed in ${describeContainers(draft, 1)}.`,
      lines,
    }
  }
  return {
    level: 'multi',
    label: `${containers} containers`,
    text: `All ${boxes(requested)} placed in ${describeContainers(draft, containers)}.`,
    lines,
  }
}
