import { describe, expect, it } from 'vitest'
import { describeContainers, describeIssue, summarizeStatus } from '../../src/ui/describe'
import { derive, edits, exampleDraft, type Draft } from '../../src/ui/state'

const statusOf = (draft: Draft) => summarizeStatus(draft, derive(draft))

/** Sets every quantity, adding rows if the example does not have enough. */
function withQuantities(qty: number[]): Draft {
  let draft = exampleDraft()
  qty.forEach((n, i) => {
    draft = edits.setTypeField(draft, draft.types[i]!.id, 'qty', String(n))
  })
  return draft
}

describe('describeContainers', () => {
  it('names the preset, and counts containers', () => {
    const draft = exampleDraft()
    expect(describeContainers(draft, 1)).toBe('one 20 ft container')
    expect(describeContainers(draft, 3)).toBe('3 × 20 ft containers')
    const custom = edits.setContainerType(draft, 'custom')
    expect(describeContainers(custom, 1)).toBe('one container')
    expect(describeContainers(custom, 2)).toBe('2 containers')
  })
})

describe('describeIssue', () => {
  it('names the field in the words the user sees', () => {
    const draft = exampleDraft()
    expect(describeIssue('container.w', 'Enter a number', draft)).toBe(
      'Container W: Enter a number',
    )
    expect(describeIssue('types[0].qty', 'Enter a whole number', draft)).toBe(
      '18 quantity: Enter a whole number',
    )
    expect(describeIssue('types[1].dims.h', 'Must be positive', draft)).toBe(
      '36 H: Must be positive',
    )
    expect(describeIssue('types[4].catalog', 'Not in the catalog', draft)).toBe(
      'P249624: Not in the catalog',
    )
    expect(describeIssue('nonsense', 'Broken', draft)).toBe('nonsense: Broken')
  })
})

describe('summarizeStatus', () => {
  it('reports one container as Fits, and more as a count', () => {
    const one = statusOf(withQuantities([1, 1, 1, 1, 1]))
    expect(one).toMatchObject({
      level: 'fits',
      label: 'Fits',
      text: 'All 5 boxes placed in one 20 ft container.',
      lines: [],
    })
    expect(statusOf(exampleDraft())).toMatchObject({
      level: 'multi',
      label: '2 containers',
      text: 'All 140 boxes placed in 2 × 20 ft containers.',
    })
  })

  it('says one box, not one boxes', () => {
    expect(statusOf(withQuantities([1, 0, 0, 0, 0])).text).toBe(
      'All 1 box placed in one 20 ft container.',
    )
  })

  it('invites a first cabinet when nothing is requested', () => {
    expect(statusOf(withQuantities([0, 0, 0, 0, 0]))).toMatchObject({
      level: 'fits',
      text: 'Add a cabinet to get started.',
    })
  })

  it('lists the fields to fix, at most four', () => {
    let draft = edits.setContainerType(exampleDraft(), 'custom')
    draft = edits.setContainer(draft, 'l', 'abc')
    for (const i of [0, 1, 2, 3]) {
      draft = edits.setTypeField(draft, draft.types[i]!.id, 'qty', 'x')
    }
    const status = statusOf(draft)
    expect(status).toMatchObject({ level: 'invalid', label: 'Fix inputs' })
    expect(status.text).toBe('5 fields need attention.')
    expect(status.lines).toEqual([
      'Container L: Enter a number',
      '18 quantity: Enter a whole number',
      '36 quantity: Enter a whole number',
      '3036 quantity: Enter a whole number',
    ])
  })

  it('names one oversized type, lists the others, and says the rest still ships', () => {
    let draft = edits.setContainerType(exampleDraft(), 'custom')
    draft = edits.setContainer(draft, 'h', '60')
    // The 96 in pantry would fit lying down, but a fragile box stays upright.
    draft = edits.setFragile(draft, 'p249624', true)
    const status = statusOf(draft)
    expect(status).toMatchObject({ level: 'impossible', label: 'Impossible' })
    expect(status.text).toContain('P249624 (24 in x 24 in x 96 in)')
    expect(status.lines).toEqual([
      'P249624: 14 boxes cannot ship in this container',
      'Everything else fits in 2 containers.',
    ])
  })

  it('caps the list of oversized types and counts the rest', () => {
    let draft = edits.setContainerType(exampleDraft(), 'custom')
    draft = edits.setContainer(draft, 'h', '10')
    // Six types, so the list stops at five and says how many are left.
    draft = edits.addType(draft)
    const id = draft.types[5]!.id
    draft = edits.setCustom(draft, id, 'Crate')
    for (const field of ['l', 'w', 'h'] as const) {
      draft = edits.setTypeField(draft, id, field, '30')
    }
    const status = statusOf(draft)
    expect(status.lines).toHaveLength(6)
    expect(status.lines[4]).toBe('P249624: 14 boxes cannot ship in this container')
    expect(status.lines[5]).toBe('and 1 more box type')
  })
})
