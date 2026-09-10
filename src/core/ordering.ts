import { volume } from './geometry'
import type { BoxType, Dims, Ordering } from './types'

/** One physical box waiting to be placed. */
export interface Item {
  typeId: string
  typeIndex: number
  dims: Dims
  volume: number
  /** Upright, against a wall, nothing on top; see BoxType.fragile. */
  fragile: boolean
}

/** One item per physical box, in box-type order. */
export function expandTypes(types: BoxType[]): Item[] {
  const items: Item[] = []
  types.forEach((t, typeIndex) => {
    const v = volume(t.dims)
    const fragile = t.fragile === true
    for (let i = 0; i < t.qty; i++) {
      items.push({ typeId: t.id, typeIndex, dims: t.dims, volume: v, fragile })
    }
  })
  return items
}

/** Deterministic 32-bit PRNG (mulberry32). Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const longestSide = (d: Dims) => Math.max(d.l, d.w, d.h)

/** Product of the two largest sides: the largest face, whatever the orientation. */
const largestFace = (d: Dims) => {
  const s = [d.l, d.w, d.h].sort((a, b) => a - b)
  return s[1]! * s[2]!
}

type Key = [(item: Item) => number, 'asc' | 'desc']

const compareBy =
  (...keys: Key[]) =>
  (a: Item, b: Item) => {
    for (const [key, dir] of keys) {
      const d = key(a) - key(b)
      if (d !== 0) return dir === 'asc' ? d : -d
    }
    return 0
  }

const byType: Key = [(it) => it.typeIndex, 'asc']

/**
 * Returns the items in the order the packer should try them. Sorting is stable,
 * so ties keep box-type order and, within a type, insertion order.
 */
export function orderItems(items: Item[], order: Ordering): Item[] {
  // Fragile boxes go last whatever the ordering, so they land on top of the
  // load rather than blocking the space above them.
  return fragileLast(orderWithin(items, order))
}

/** Stable, so each half keeps the order it was given. */
function fragileLast(items: Item[]): Item[] {
  return [...items.filter((it) => !it.fragile), ...items.filter((it) => it.fragile)]
}

function orderWithin(items: Item[], order: Ordering): Item[] {
  if (typeof order === 'object') return jitteredByVolume(items, order.shuffle)
  switch (order) {
    case 'volume-desc':
      return [...items].sort(
        compareBy([(it) => it.volume, 'desc'], [(it) => longestSide(it.dims), 'desc'], byType),
      )
    case 'volume-asc':
      return [...items].sort(
        compareBy([(it) => it.volume, 'asc'], [(it) => longestSide(it.dims), 'asc'], byType),
      )
    case 'height-desc':
      return [...items].sort(
        compareBy([(it) => longestSide(it.dims), 'desc'], [(it) => it.volume, 'desc'], byType),
      )
    case 'footprint-desc':
      return [...items].sort(
        compareBy([(it) => largestFace(it.dims), 'desc'], [(it) => it.volume, 'desc'], byType),
      )
    case 'round-robin':
      return roundRobin(items)
  }
}

/** Types sorted by volume descending, then one box of each type per round while any remain. */
function roundRobin(items: Item[]): Item[] {
  const groups = new Map<number, Item[]>()
  for (const it of items) {
    const group = groups.get(it.typeIndex)
    if (group) group.push(it)
    else groups.set(it.typeIndex, [it])
  }
  const queues = [...groups.values()].sort(
    (a, b) => b[0]!.volume - a[0]!.volume || a[0]!.typeIndex - b[0]!.typeIndex,
  )
  const result: Item[] = []
  let cursor = 0
  while (result.length < items.length) {
    for (const queue of queues) {
      const it = queue[cursor]
      if (it) result.push(it)
    }
    cursor++
  }
  return result
}

/**
 * Volume descending with a seeded random jitter of +/- 25 % on each item's
 * key. Big boxes still tend to go first, but the exact order varies with the
 * seed, which gives the optimizer different packings to choose from.
 */
function jitteredByVolume(items: Item[], seed: number): Item[] {
  const rand = mulberry32(seed)
  const keyed = items.map((it) => ({ it, key: it.volume * (0.75 + 0.5 * rand()) }))
  keyed.sort((a, b) => b.key - a.key || a.it.typeIndex - b.it.typeIndex)
  return keyed.map((k) => k.it)
}
