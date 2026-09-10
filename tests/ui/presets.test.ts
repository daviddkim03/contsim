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
    expect(CONTAINER_TYPES).toEqual(['20ft', '40ft-hc', 'custom'])
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

  it('carries the payload each container is loaded to', () => {
    expect(presetFor('20ft')!.payloadKg).toBe(11000)
    expect(presetFor('40ft-hc')!.payloadKg).toBe(19000)
    expect(presetPayloadText(presetFor('20ft')!, 'kg')).toBe('11000')
    expect(presetPayloadText(presetFor('20ft')!, 'lb')).toBe('24251')
    expect(presetPayloadText(presetFor('40ft-hc')!, 'lb')).toBe('41888')
  })

  it('makes the high cube taller, and twice as long as the 20 ft box', () => {
    expect(presetFor('40ft-hc')!.mm.h).toBeGreaterThan(presetFor('20ft')!.mm.h)
    expect(presetFor('40ft-hc')!.mm.l).toBeGreaterThan(presetFor('20ft')!.mm.l * 2)
    for (const p of CONTAINER_PRESETS) expect(p.mm.w).toBe(2352)
  })
})
