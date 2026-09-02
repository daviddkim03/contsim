/**
 * Human-readable descriptions of the current state, shared by the status
 * panel, the sidebar and the Excel report so they never disagree.
 */

import { describeImpossibility, type Objective } from '../core'
import type { Derived, Draft } from './state'
import { formatLength, formatVolume } from './units'

export type Level = 'fits' | 'not-found' | 'impossible' | 'invalid'

export const LEVEL_LABELS: Record<Level, string> = {
  fits: 'Fits',
  'not-found': "Doesn't fit",
  impossible: 'Impossible',
  invalid: 'Fix inputs',
}

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  'keep-most-boxes': 'Keep most boxes',
  'keep-most-volume': 'Keep most volume',
  'cut-evenly': 'Cut evenly',
}

export interface StatusSummary {
  level: Level
  label: string
  /** One sentence for the badge's message line. */
  text: string
  /** Extra lines: the fields to fix, or the box types left out. */
  lines: string[]
}

/** Turns a validation path such as "types[1].dims.h" into "Box name H". */
export function describeIssue(path: string, message: string, draft: Draft): string {
  const container = /^container\.(l|w|h)$/.exec(path)
  if (container) return `Container ${container[1]!.toUpperCase()}: ${message}`
  const type = /^types\[(\d+)\]\.(?:dims\.(l|w|h)|(qty)|(id))$/.exec(path)
  if (type) {
    const t = draft.types[Number(type[1])]
    const name = t?.name.trim() || `Box ${Number(type[1]) + 1}`
    const field = type[2] ? type[2].toUpperCase() : type[3] ? 'quantity' : 'id'
    return `${name} ${field}: ${message}`
  }
  return `${path}: ${message}`
}

export function summarizeStatus(draft: Draft, derived: Derived): StatusSummary {
  const { result, scenario, scale, issues } = derived
  const lines: string[] = []

  if (!result || !scenario) {
    const entries = Object.entries(issues)
    for (const [path, msg] of entries.slice(0, 4)) lines.push(describeIssue(path, msg, draft))
    return {
      level: 'invalid',
      label: LEVEL_LABELS.invalid,
      text:
        entries.length === 1
          ? 'One field needs attention.'
          : `${entries.length} fields need attention.`,
      lines,
    }
  }
  if (result.status === 'fits') {
    return {
      level: 'fits',
      label: LEVEL_LABELS.fits,
      text:
        result.stats.requested === 0
          ? 'Add a box type to get started.'
          : `All ${result.stats.requested} boxes placed.`,
      lines,
    }
  }
  if (result.status === 'not-found') {
    for (const t of scenario.types) {
      const n = result.unplaced[t.id]
      if (n) lines.push(`${t.name}: ${n} left out`)
    }
    return {
      level: 'not-found',
      label: LEVEL_LABELS['not-found'],
      text: `Placed ${result.stats.placed} of ${result.stats.requested}. No arrangement found for the rest; it may still be possible. Try Optimize or reduce quantities.`,
      lines,
    }
  }
  return {
    level: 'impossible',
    label: LEVEL_LABELS.impossible,
    text: describeImpossibility(result.impossibility!, scenario.types, {
      length: (n) => formatLength(n, scale, draft.unit),
      volume: (n) => formatVolume(n, scale, draft.unit),
    }),
    lines,
  }
}
