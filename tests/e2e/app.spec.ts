import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readSheet, text, unzip } from '../helpers/unzip'

const badge = (page: Page) => page.locator('.badge')
const row = (page: Page, index: number) => page.locator('.box-row').nth(index)
const qty = (page: Page, index: number) => row(page, index).locator('[data-field="qty"]')

/** Example rows: 0 pallet, 1 crate, 2 medium, 3 tote, 4 small. */
async function setQuantities(page: Page, values: number[]) {
  for (const [i, v] of values.entries()) await qty(page, i).fill(String(v))
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('opens on the example scenario, which does not fit', async ({ page }) => {
  await expect(page).toHaveTitle('contsim')
  await expect(badge(page)).toHaveText("Doesn't fit")
  await expect(page.locator('[data-stat="placed"]')).toHaveText('123 / 138')
  await expect(page.locator('.box-row')).toHaveCount(5)
  await expect(page.locator('.legend-row')).toHaveCount(5)
  await expect(page.locator('.legend-row.short .legend-count')).toHaveText('25 / 40')
  await expect(page.locator('.stage-3d canvas')).toBeVisible()
  await expect(page.locator('.stage-3d')).toHaveAttribute('data-boxes', '123')
})

test('quantities update the result live and survive a reload', async ({ page }) => {
  await setQuantities(page, [6, 3, 20, 10, 30])
  await expect(badge(page)).toHaveText('Fits')
  await expect(page.locator('.message')).toHaveText('All 69 boxes placed.')

  await page.reload()
  await expect(qty(page, 0)).toHaveValue('6')
  await expect(qty(page, 4)).toHaveValue('30')
  await expect(badge(page)).toHaveText('Fits')
})

test('steppers change a quantity by one and stop at zero', async ({ page }) => {
  const crate = row(page, 1)
  await crate.locator('[data-action="inc"]').click()
  await expect(qty(page, 1)).toHaveValue('7')
  await qty(page, 1).fill('1')
  await crate.locator('[data-action="dec"]').click()
  await crate.locator('[data-action="dec"]').click()
  await expect(qty(page, 1)).toHaveValue('0')
})

test('invalid input is flagged, explained, and never crashes', async ({ page }) => {
  const length = page.locator('[data-field="container.l"]')
  await length.fill('abc')
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(length).toHaveClass(/invalid/)
  await expect(page.locator('.details li')).toHaveText(['Container L: Enter a number'])

  await qty(page, 2).fill('2.5')
  await expect(page.locator('.details li')).toHaveText([
    'Container L: Enter a number',
    'Medium carton quantity: Enter a whole number',
  ])

  await length.fill('232')
  await qty(page, 2).fill('40')
  await expect(badge(page)).toHaveText("Doesn't fit")
})

test('impossible scenarios explain why, in display units', async ({ page }) => {
  await page.locator('[data-field="container.h"]').fill('10')
  await expect(badge(page)).toHaveText('Impossible')
  await expect(page.locator('.message')).toHaveText(
    'Pallet box (48 in x 40 in x 48 in) does not fit in the container in any allowed orientation.',
  )

  await page.locator('[data-field="container.h"]').fill('94')
  await qty(page, 0).fill('30')
  await expect(page.locator('.message')).toHaveText(
    'Total box volume 2,052.6 cu ft exceeds the container volume 1,161.1 cu ft.',
  )
})

test('adding and removing box types', async ({ page }) => {
  await page.locator('[data-action="add"]').click()
  await expect(page.locator('.box-row')).toHaveCount(6)
  const added = row(page, 5)
  await expect(added.locator('[data-field="name"]')).toHaveValue('Box A')
  await expect(added.locator('[data-field="l"]')).toBeFocused()
  await expect(badge(page)).toHaveText('Fix inputs')

  await added.locator('[data-field="l"]').fill('10')
  await added.locator('[data-field="w"]').fill('10')
  await added.locator('[data-field="h"]').fill('10')
  await expect(badge(page)).toHaveText("Doesn't fit")
  await expect(page.locator('.legend-row')).toHaveCount(6)

  await added.locator('[data-action="remove"]').click()
  await expect(page.locator('.box-row')).toHaveCount(5)
})

test('the table view lists every placement', async ({ page }) => {
  await expect(page.locator('.stage-table')).toBeHidden()
  await page.locator('[data-mode="table"]').click()
  await expect(page.locator('.stage-table')).toBeVisible()
  await expect(page.locator('.stage-3d')).toBeHidden()
  await expect(page.locator('tbody tr')).toHaveCount(123)
  await expect(page.locator('tbody tr').first()).toContainText('Pallet box')
  await page.locator('[data-mode="3d"]').click()
  await expect(page.locator('.stage-3d canvas')).toBeVisible()
})

test('the layer slider hides boxes above the chosen height', async ({ page }) => {
  const slider = page.locator('[data-field="layer"]')
  const label = page.locator('[data-role="layer-label"]')
  await expect(label).toHaveText('Layer: all')
  await expect(slider).toHaveAttribute('max', '94')

  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '0'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(label).toHaveText('Layer: up to 0 in')
  const floorBoxes = Number(await page.locator('.stage-3d').getAttribute('data-boxes'))
  expect(floorBoxes).toBeGreaterThan(0)
  expect(floorBoxes).toBeLessThan(123)

  await slider.evaluate((el: HTMLInputElement) => {
    el.value = el.max
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(label).toHaveText('Layer: all')
  await expect(page.locator('.stage-3d')).toHaveAttribute('data-boxes', '123')
})

test('hovering a legend or sidebar row highlights that box type', async ({ page }) => {
  const stage = page.locator('.stage-3d')
  await page.locator('.legend-row').nth(2).hover()
  await expect(stage).toHaveAttribute('data-hover', 'medium')
  await page.locator('.box-row').nth(1).hover()
  await expect(stage).toHaveAttribute('data-hover', 'crate')
  await page.locator('.status').hover()
  await expect(stage).toHaveAttribute('data-hover', '')
})

test('Optimize proposes reductions and Apply makes everything fit', async ({ page }) => {
  const optimize = page.locator('[data-action="optimize"]')
  await expect(optimize).toBeEnabled()
  await optimize.click()
  const popover = page.locator('.optimize-popover')
  await expect(popover).toBeVisible({ timeout: 10_000 })
  // Plain packing places 123 of 138; the optimizer must do at least as well and propose a fitting plan.
  const title = popover.locator('[data-role="popover-title"]')
  await expect(title).toHaveText(/^Keep \d+ of 138 boxes$/)
  const kept = Number(/Keep (\d+) of/.exec((await title.textContent()) ?? '')?.[1])
  expect(kept).toBeGreaterThanOrEqual(123)
  expect(kept).toBeLessThan(138)
  await expect(popover.locator('.reductions li')).not.toHaveCount(0)
  await expect(popover.locator('.reduction-change').first()).toContainText('→')

  await popover.locator('[data-action="apply"]').click()
  await expect(popover).toBeHidden()
  await expect(badge(page)).toHaveText('Fits')
  await expect(optimize).toBeDisabled()
})

test('Discard keeps the current quantities', async ({ page }) => {
  await page.locator('[data-action="optimize"]').click()
  const popover = page.locator('.optimize-popover')
  await expect(popover).toBeVisible({ timeout: 10_000 })
  await popover.locator('[data-action="discard"]').click()
  await expect(popover).toBeHidden()
  await expect(badge(page)).toHaveText("Doesn't fit")
  await expect(qty(page, 2)).toHaveValue('40')
})

test('export downloads the scenario and import restores it', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="export-json"]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('contsim-scenario.json')
  const path = await download.path()

  await qty(page, 0).fill('3')
  await expect(qty(page, 0)).toHaveValue('3')
  await page.locator('[data-field="import-file"]').setInputFiles(path)
  await expect(qty(page, 0)).toHaveValue('12')
  await expect(badge(page)).toHaveText("Doesn't fit")
})

test('Export Excel downloads a workbook with summary, boxes and placements', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="export-excel"]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('contsim-packing.xlsx')
  const parts = unzip(new Uint8Array(await readFile((await download.path())!)))

  expect(text(parts.get('xl/workbook.xml')!)).toContain(
    '<sheet name="Summary" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Boxes" sheetId="2" r:id="rId2"/>' +
      '<sheet name="Placements" sheetId="3" r:id="rId3"/>',
  )
  const summary = readSheet(text(parts.get('xl/worksheets/sheet1.xml')!))
  expect(summary).toContainEqual(['Status', "Doesn't fit"])
  expect(summary).toContainEqual(['Container length (in)', 232])
  expect(summary).toContainEqual(['Boxes placed', 123])
  const boxes = readSheet(text(parts.get('xl/worksheets/sheet2.xml')!))
  expect(boxes).toHaveLength(6)
  expect(boxes[3]!.slice(1, 9)).toEqual(['Medium carton', '#10b981', 24, 18, 18, 40, 25, 15])
  const placements = readSheet(text(parts.get('xl/worksheets/sheet3.xml')!))
  expect(placements).toHaveLength(124)
  expect(placements[1]!.slice(0, 5)).toEqual([1, 'Pallet box', 0, 0, 0])
  expect([...(placements[1]!.slice(5, 8) as number[])].sort((a, b) => a - b)).toEqual([40, 48, 48])
})

test('Export Excel waits for the inputs to be valid', async ({ page }) => {
  const button = page.locator('[data-action="export-excel"]')
  await expect(button).toBeEnabled()
  await page.locator('[data-field="container.l"]').fill('abc')
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(button).toBeDisabled()
  await page.locator('[data-field="container.l"]').fill('232')
  await expect(button).toBeEnabled()
})

test('importing a file that is not a scenario changes nothing and says so', async ({ page }) => {
  await page.locator('[data-field="import-file"]').evaluate((input: HTMLInputElement) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['{"nope": 1}'], 'notes.json', { type: 'application/json' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.locator('[data-role="footer-hint"]')).toHaveText(
    'notes.json is not a contsim scenario.',
  )
  await expect(qty(page, 0)).toHaveValue('12')
})

test('smoke: example, bump a quantity, Optimize, Apply, Fits', async ({ page }) => {
  await setQuantities(page, [6, 3, 20, 10, 30])
  await expect(badge(page)).toHaveText('Fits')
  // Add pallet boxes one at a time until the packer can no longer fit everything.
  const pallet = row(page, 0)
  for (let i = 0; i < 30 && (await badge(page).textContent()) === 'Fits'; i++) {
    await pallet.locator('[data-action="inc"]').click()
    await expect(page.locator('.status')).not.toHaveClass(/stale/)
  }
  await expect(badge(page)).not.toHaveText('Fits')
  await page.locator('[data-action="optimize"]').click()
  const popover = page.locator('.optimize-popover')
  await expect(popover).toBeVisible({ timeout: 10_000 })
  await popover.locator('[data-action="apply"]').click()
  await expect(badge(page)).toHaveText('Fits')
})
