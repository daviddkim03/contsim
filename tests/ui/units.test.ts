import { describe, expect, it } from 'vitest'
import {
  convertWeight,
  decimalsOf,
  formatLength,
  formatVolume,
  formatWeight,
  fromGrams,
  fromInt,
  parseCount,
  parseLength,
  scaleFor,
  toGrams,
  toInt,
} from '../../src/ui/units'

describe('parseLength', () => {
  it('accepts plain and decimal numbers with surrounding spaces', () => {
    expect(parseLength('12')).toBe(12)
    expect(parseLength(' 12.5 ')).toBe(12.5)
    expect(parseLength('.5')).toBe(0.5)
    expect(parseLength('12.')).toBe(12)
    expect(parseLength('0')).toBe(0)
  })

  it('rejects everything else', () => {
    for (const bad of ['', ' ', '.', 'abc', '1e3', '-1', '1,5', '1 2', 'NaN', '12in']) {
      expect(parseLength(bad), bad).toBeNull()
    }
  })
})

describe('parseCount', () => {
  it('accepts whole numbers only', () => {
    expect(parseCount('7')).toBe(7)
    expect(parseCount(' 0 ')).toBe(0)
    for (const bad of ['', '1.5', '-1', 'x', '1e2']) expect(parseCount(bad), bad).toBeNull()
  })
})

describe('scaling', () => {
  it('counts significant decimals, ignoring trailing zeros and capping at 3', () => {
    expect(decimalsOf('12')).toBe(0)
    expect(decimalsOf('12.50')).toBe(1)
    expect(decimalsOf('0.125')).toBe(3)
    expect(decimalsOf('0.12345')).toBe(3)
    expect(decimalsOf('junk')).toBe(0)
  })

  it('picks one scale for all lengths so every value becomes an integer', () => {
    expect(scaleFor(['12', '8'])).toBe(1)
    expect(scaleFor(['12', '8.25', '1.5'])).toBe(100)
    expect(scaleFor([])).toBe(1)
  })

  it('round-trips through integers without float drift', () => {
    const scale = scaleFor(['1.1', '2.2'])
    expect(toInt(1.1, scale)).toBe(11)
    expect(toInt(2.2, scale)).toBe(22)
    expect(fromInt(33, scale)).toBe(3.3)
    expect(toInt(0.1, 10) + toInt(0.2, 10)).toBe(toInt(0.3, 10))
  })
})

describe('formatting', () => {
  it('formats lengths in the display unit', () => {
    expect(formatLength(232, 1, 'in')).toBe('232 in')
    expect(formatLength(1250, 100, 'cm')).toBe('12.5 cm')
    expect(formatLength(2006336, 1, 'in')).toBe('2,006,336 in')
  })

  it('formats volumes in cubic feet or cubic metres', () => {
    expect(formatVolume(1728, 1, 'in')).toBe('1 cu ft')
    expect(formatVolume(2006336, 1, 'in')).toBe('1,161.1 cu ft')
    expect(formatVolume(10, 1, 'ft')).toBe('10 cu ft')
    expect(formatVolume(1_000_000, 1, 'cm')).toBe('1 m³')
    expect(formatVolume(1_000_000_000, 1, 'mm')).toBe('1 m³')
    expect(formatVolume(2, 1, 'm')).toBe('2 m³')
    // Scaled integers: 12.5 cm cube = 1953.125 cm³ = 0.00195 m³
    expect(formatVolume(1250 ** 3, 100, 'cm')).toBe('0 m³')
  })
})

describe('weights', () => {
  it('converts to whole grams, so the core compares them exactly', () => {
    expect(toGrams(12.5, 'kg')).toBe(12500)
    expect(toGrams(1, 'lb')).toBe(454)
    expect(toGrams(0, 'kg')).toBe(0)
    expect(fromGrams(12500, 'kg')).toBe(12.5)
    expect(fromGrams(453.59237, 'lb')).toBeCloseTo(1, 6)
  })

  it('converts between the two units, keeping three decimals', () => {
    expect(convertWeight(10, 'kg', 'kg')).toBe(10)
    expect(convertWeight(1, 'kg', 'lb')).toBe(2.205)
    expect(convertWeight(2.205, 'lb', 'kg')).toBe(1)
    expect(convertWeight(1000, 'kg', 'lb')).toBe(2204.623)
  })

  it('shows a load without decimals, and a single box with them', () => {
    expect(formatWeight(28_280_000, 'kg')).toBe('28,280 kg')
    expect(formatWeight(27_000, 'kg')).toBe('27 kg')
    expect(formatWeight(34_500, 'kg')).toBe('34.5 kg')
    expect(formatWeight(0, 'kg')).toBe('0 kg')
    expect(formatWeight(453_592, 'lb')).toBe('1,000 lb')
  })
})
