import type { BoxType, Container, Dims } from './types'

/**
 * Largest dimension the core accepts, in integer units. Positions and extents
 * never exceed a container dimension, so they stay exact well below
 * Number.MAX_SAFE_INTEGER. Volumes are only used for the volume check and the
 * fill ratio, where float rounding at the 1e-16 level is harmless.
 */
export const MAX_DIM = 10_000_000

/** Largest quantity per box type. Keeps the packer's runtime bounded. */
export const MAX_QTY = 10_000

export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. "types[2].dims.h". */
  path: string
  message: string
}

/** Structural validation of a scenario. Returns every issue found; an empty list means valid. */
export function validateScenario(container: Container, types: BoxType[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  checkDims('container', container, issues)

  const seenIds = new Set<string>()
  types.forEach((t, i) => {
    const path = `types[${i}]`
    if (!t.id) issues.push({ path: `${path}.id`, message: 'id is required' })
    else if (seenIds.has(t.id))
      issues.push({ path: `${path}.id`, message: `duplicate id "${t.id}"` })
    seenIds.add(t.id)

    checkDims(`${path}.dims`, t.dims, issues)

    if (!Number.isSafeInteger(t.qty) || t.qty < 0) {
      issues.push({ path: `${path}.qty`, message: 'quantity must be a non-negative integer' })
    } else if (t.qty > MAX_QTY) {
      issues.push({ path: `${path}.qty`, message: `quantity must be at most ${MAX_QTY}` })
    }
  })

  return issues
}

function checkDims(path: string, dims: Dims, issues: ValidationIssue[]): void {
  for (const key of ['l', 'w', 'h'] as const) {
    const v = dims[key]
    if (!Number.isSafeInteger(v) || v <= 0) {
      issues.push({ path: `${path}.${key}`, message: 'must be a positive integer' })
    } else if (v > MAX_DIM) {
      issues.push({ path: `${path}.${key}`, message: `must be at most ${MAX_DIM}` })
    }
  }
}
