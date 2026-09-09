import { describe, expect, it } from 'vitest'
import {
  CONTAINER_PRESETS,
  CONTAINER_TYPES,
  containerTypeName,
  mmToUnit,
  presetDims,
  presetFor,
  presetPayloadText,
  presetTexts,
} from '../../src/ui/presets'

describe('container presets', () => {
  it('lists every preset once, then custom', () => {
    expect(CONTAINER_TYPES).toEqual([
      '10ft',
      '20ft',
      '20ft-hc',
      '40ft',
      '40ft-hc',
      '45ft-hc',
      'custom',
    ])
    expect(new Set(CONTAINER_PRESETS.map((p) => p.id)).size).toBe(CONTAINER_PRESETS.length)
    expect(presetFor('custom')).toBeNull()
    expect(presetFor('20ft')?.name).toBe('20 ft')
    expect(containerTypeName('40ft-hc')).toBe('40 ft high cube')
    expect(containerTypeName('custom')).toBe('custom')
  })

  it('converts millimetres to each unit with sensible decimals', () => {
    expect(mmToUnit(5898, 'mm')).toBe(5898)
    expect(mmToUnit(5898, 'cm')).toBe(589.8)
    expect(mmToUnit(5898, 'm')).toBe(5.898)
    expect(mmToUnit(5898, 'in')).toBe(232.2)
    expect(mmToUnit(5898, 'ft')).toBe(19.35)
  })

  it('gives the 20 ft container its familiar interior size', () => {
    const preset = presetFor('20ft')!
    expect(presetDims(preset, 'in')).toEqual({ l: 232.2, w: 92.6, h: 94.2 })
    expect(presetDims(preset, 'm')).toEqual({ l: 5.898, w: 2.352, h: 2.393 })
    expect(presetTexts(preset, 'ft')).toEqual({ l: '19.35', w: '7.72', h: '7.85' })
  })

  it('carries a payload for every container, biggest for the 20 ft box', () => {
    for (const preset of CONTAINER_PRESETS) expect(preset.payloadKg).toBeGreaterThan(1000)
    // A 20 ft container carries the most: same gross limit, lightest of the big boxes.
    expect(presetFor('20ft')!.payloadKg).toBeGreaterThan(presetFor('40ft')!.payloadKg)
    expect(presetFor('10ft')!.payloadKg).toBeLessThan(presetFor('20ft')!.payloadKg)
    expect(presetPayloadText(presetFor('20ft')!, 'kg')).toBe('28280')
    expect(presetPayloadText(presetFor('20ft')!, 'lb')).toBe('62347')
  })

  it('makes high cubes taller and 40 ft twice as long as 20 ft', () => {
    expect(presetFor('40ft-hc')!.mm.h).toBeGreaterThan(presetFor('40ft')!.mm.h)
    expect(presetFor('40ft')!.mm.l).toBeGreaterThan(presetFor('20ft')!.mm.l * 2)
    for (const p of CONTAINER_PRESETS) expect(p.mm.w).toBe(2352)
  })
})
