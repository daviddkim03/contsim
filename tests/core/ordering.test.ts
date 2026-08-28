import { describe, expect, it } from 'vitest'
import { expandTypes, mulberry32, orderItems, type Item } from '../../src/core/ordering'
import { boxType } from './fixtures'

const types = [
  boxType('big', 4, 4, 4, 3),
  boxType('flat', 8, 8, 1, 1),
  boxType('long', 10, 1, 1, 2),
  boxType('small', 1, 1, 1, 4),
]
const items = expandTypes(types)
const ids = (list: Item[]) => list.map((it) => it.typeId)

describe('expandTypes', () => {
  it('creates one item per physical box, in type order', () => {
    expect(ids(items)).toEqual([
      'big',
      'big',
      'big',
      'flat',
      'long',
      'long',
      'small',
      'small',
      'small',
      'small',
    ])
    expect(items[0]).toMatchObject({ typeIndex: 0, volume: 64, dims: { l: 4, w: 4, h: 4 } })
  })
})

describe('orderItems', () => {
  it('volume-desc sorts by volume, then by longest side', () => {
    // big and flat both have volume 64; flat has the longer side so it goes first.
    expect(ids(orderItems(items, 'volume-desc'))).toEqual([
      'flat',
      'big',
      'big',
      'big',
      'long',
      'long',
      'small',
      'small',
      'small',
      'small',
    ])
  })

  it('volume-asc is the reverse preference', () => {
    expect(ids(orderItems(items, 'volume-asc'))).toEqual([
      'small',
      'small',
      'small',
      'small',
      'long',
      'long',
      'big',
      'big',
      'big',
      'flat',
    ])
  })

  it('height-desc sorts by longest side first', () => {
    expect(ids(orderItems(items, 'height-desc'))).toEqual([
      'long',
      'long',
      'flat',
      'big',
      'big',
      'big',
      'small',
      'small',
      'small',
      'small',
    ])
  })

  it('footprint-desc sorts by the largest face first', () => {
    expect(ids(orderItems(items, 'footprint-desc'))).toEqual([
      'flat',
      'big',
      'big',
      'big',
      'long',
      'long',
      'small',
      'small',
      'small',
      'small',
    ])
  })

  it('round-robin takes one box of each type per round, largest type first', () => {
    expect(ids(orderItems(items, 'round-robin'))).toEqual([
      'big',
      'flat',
      'long',
      'small',
      'big',
      'long',
      'small',
      'big',
      'small',
      'small',
    ])
  })

  it('shuffle is a permutation that depends only on the seed', () => {
    // Volumes 27 and 24: the +/- 25 % jitter ranges overlap, so seeds interleave the types differently.
    const many = expandTypes([boxType('a', 3, 3, 3, 15), boxType('b', 2, 3, 4, 15)])
    const first = orderItems(many, { shuffle: 7 })
    expect(orderItems(many, { shuffle: 7 })).toEqual(first)
    expect([...ids(first)].sort()).toEqual([...ids(many)].sort())
    expect(ids(orderItems(many, { shuffle: 8 }))).not.toEqual(ids(first))
  })

  it('does not mutate its input', () => {
    const before = ids(items)
    orderItems(items, 'volume-asc')
    expect(ids(items)).toEqual(before)
  })
})

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const values = Array.from({ length: 1000 }, () => a())
    expect(Array.from({ length: 1000 }, () => b())).toEqual(values)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(new Set(values).size).toBeGreaterThan(990)
  })
})
