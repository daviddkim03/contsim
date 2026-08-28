import { describe, expect, it } from 'vitest'
import type { BoxType, Container } from '../../src/core/types'
import { MAX_DIM, MAX_QTY, validateScenario, type ValidationIssue } from '../../src/core/validate'

const container: Container = { l: 10, w: 10, h: 10 }
const type = (overrides: Partial<BoxType> = {}): BoxType => ({
  id: 'a',
  name: 'A',
  dims: { l: 1, w: 2, h: 3 },
  qty: 1,
  color: '#000000',
  ...overrides,
})
const paths = (issues: ValidationIssue[]) => issues.map((i) => i.path)

describe('validateScenario', () => {
  it('accepts a valid scenario', () => {
    expect(validateScenario(container, [type(), type({ id: 'b' })])).toEqual([])
  })

  it('accepts an empty box list', () => {
    expect(validateScenario(container, [])).toEqual([])
  })

  it('rejects container dims that are not positive integers', () => {
    expect(paths(validateScenario({ l: 0, w: 1.5, h: -3 }, []))).toEqual([
      'container.l',
      'container.w',
      'container.h',
    ])
  })

  it('rejects dims above MAX_DIM but accepts MAX_DIM itself', () => {
    expect(paths(validateScenario({ l: MAX_DIM + 1, w: 1, h: 1 }, []))).toEqual(['container.l'])
    expect(validateScenario({ l: MAX_DIM, w: 1, h: 1 }, [])).toEqual([])
  })

  it('rejects box dims that are not positive integers', () => {
    const bad = type({ dims: { l: NaN, w: 2, h: 3 } })
    expect(paths(validateScenario(container, [bad]))).toEqual(['types[0].dims.l'])
  })

  it('rejects negative, fractional and huge quantities', () => {
    expect(paths(validateScenario(container, [type({ qty: -1 })]))).toEqual(['types[0].qty'])
    expect(paths(validateScenario(container, [type({ qty: 1.5 })]))).toEqual(['types[0].qty'])
    expect(paths(validateScenario(container, [type({ qty: MAX_QTY + 1 })]))).toEqual([
      'types[0].qty',
    ])
  })

  it('accepts quantity 0 and MAX_QTY', () => {
    expect(validateScenario(container, [type({ qty: 0 })])).toEqual([])
    expect(validateScenario(container, [type({ qty: MAX_QTY })])).toEqual([])
  })

  it('rejects missing and duplicate ids', () => {
    const types = [type({ id: '' }), type({ id: 'a' }), type({ id: 'a' })]
    expect(paths(validateScenario(container, types))).toEqual(['types[0].id', 'types[2].id'])
  })

  it('reports every issue, not only the first', () => {
    const issues = validateScenario({ l: 0, w: 10, h: 10 }, [type({ qty: -1 })])
    expect(paths(issues)).toEqual(['container.l', 'types[0].qty'])
    for (const issue of issues) expect(issue.message).toBeTruthy()
  })
})
