import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readSheet, text, unzip } from '../helpers/unzip'

const badge = (page: Page) => page.locator('.badge')
const row = (page: Page, index: number) => page.locator('.box-row').nth(index)
const qty = (page: Page, index: number) => row(page, index).locator('[data-field="qty"]')
const progress = (page: Page) => page.locator('[data-role="progress"]')

/**
 * Example rows: 0 "36" (20), 1 "18" (20), 2 DB18 (10), 3 SB36 (10), 4 BC36 (10),
 * 5 "3036" (30), 6 "1830" (20), 7 "2442" (10), 8 P249624 (10), 9 VSB36 (10).
 * 150 cabinets: first fit needs two 20 ft containers (66 + 84 boxes).
 */
async function setQuantities(page: Page, values: number[]) {
  for (const [i, v] of values.entries()) await qty(page, i).fill(String(v))
}

/** About 55 % of the example: fits in one 20 ft container. */
const ONE_CONTAINER = [11, 11, 5, 5, 5, 16, 11, 5, 5, 5]

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('opens on the example order, which needs two containers', async ({ page }) => {
  await expect(page).toHaveTitle('contsim')
  await expect(badge(page)).toHaveText('2 containers')
  await expect(page.locator('.message')).toHaveText('All 150 boxes placed in 2 × 20 ft containers.')
  await expect(page.locator('[data-stat="containers"]')).toHaveText('2')
  await expect(page.locator('[data-stat="placed"]')).toHaveText('150 / 150')
  await expect(page.locator('.box-row')).toHaveCount(10)
  await expect(page.locator('.legend-row')).toHaveCount(10)
  await expect(page.locator('.legend-row.short')).toHaveCount(0)
  await expect(page.locator('.container-row')).toHaveCount(2)
  await expect(page.locator('.container-row.selected')).toContainText('Container 1')
  await expect(page.locator('.stage-3d canvas')).toBeVisible()
  // The optimizer runs in the background and settles on the same two containers.
  await expect(progress(page)).toBeHidden()
  await expect(page.locator('.stage-3d')).toHaveAttribute('data-boxes', '66')
})

test('quantities update the result live and survive a reload', async ({ page }) => {
  await setQuantities(page, ONE_CONTAINER)
  await expect(badge(page)).toHaveText('Fits')
  await expect(page.locator('.message')).toHaveText('All 79 boxes placed in one 20 ft container.')
  await expect(page.locator('.container-row')).toHaveCount(0)

  await page.reload()
  await expect(qty(page, 0)).toHaveValue('11')
  await expect(qty(page, 5)).toHaveValue('16')
  await expect(badge(page)).toHaveText('Fits')
})

test('steppers change a quantity by one and stop at zero', async ({ page }) => {
  const base18 = row(page, 1)
  await base18.locator('[data-action="inc"]').click()
  await expect(qty(page, 1)).toHaveValue('21')
  await qty(page, 1).fill('1')
  await base18.locator('[data-action="dec"]').click()
  await base18.locator('[data-action="dec"]').click()
  await expect(qty(page, 1)).toHaveValue('0')
})

test('invalid input is flagged, explained, and never crashes', async ({ page }) => {
  await page.locator('[data-field="containerType"]').selectOption('custom')
  const length = page.locator('[data-field="container.l"]')
  await length.fill('abc')
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(length).toHaveClass(/invalid/)
  await expect(page.locator('.details li')).toHaveText(['Container L: Enter a number'])

  await qty(page, 2).fill('2.5')
  await expect(page.locator('.details li')).toHaveText([
    'Container L: Enter a number',
    'DB18 quantity: Enter a whole number',
  ])

  await length.fill('232.2')
  await qty(page, 2).fill('10')
  await expect(badge(page)).toHaveText('2 containers')
})

test('a box that fits in no container is impossible, in display units', async ({ page }) => {
  await page.locator('[data-field="containerType"]').selectOption('custom')
  await page.locator('[data-field="container.h"]').fill('10')
  await expect(badge(page)).toHaveText('Impossible')
  await expect(page.locator('.message')).toHaveText(
    '36 (36 in x 24 in x 34.5 in) does not fit in the container in any allowed orientation.',
  )
  await expect(page.locator('.details li').first()).toHaveText(
    '36: 20 boxes cannot ship in this container',
  )
  await expect(page.locator('.details li')).toHaveCount(6)
  await expect(page.locator('.details li').last()).toHaveText('and 5 more box types')

  // Only the pantries are too tall for a 60 in ceiling when kept upright; the rest still ships.
  await page.locator('[data-field="container.h"]').fill('60')
  await page.locator('[data-field="keepUpright"]').check()
  await expect(badge(page)).toHaveText('Impossible')
  await expect(page.locator('.message')).toContainText('P249624 (24 in x 24 in x 96 in)')
  await expect(page.locator('.details li').last()).toContainText('Everything else fits in')
  await expect(page.locator('.legend-row.short .legend-count')).toContainText('0 / 10')
})

test('a standard container fills the dimensions and locks them', async ({ page }) => {
  const type = page.locator('[data-field="containerType"]')
  const length = page.locator('[data-field="container.l"]')
  await expect(type).toHaveValue('20ft')
  await expect(length).toHaveValue('232.2')
  await expect(length).toBeDisabled()
  await expect(page.locator('[data-role="container-hint"]')).toContainText('Typical interior size')

  await type.selectOption('40ft-hc')
  await expect(length).toHaveValue('473.7')
  await expect(page.locator('[data-field="container.h"]')).toHaveValue('106.2')
  await expect(badge(page)).toHaveText('Fits')
  await expect(page.locator('.message')).toHaveText(
    'All 150 boxes placed in one 40 ft high cube container.',
  )

  await page.locator('[data-field="unit"]').selectOption('mm')
  await expect(length).toHaveValue('12032')

  await type.selectOption('custom')
  await expect(length).toBeEnabled()
  await expect(length).toHaveValue('12032')
  await page.reload()
  await expect(type).toHaveValue('custom')
  await expect(length).toHaveValue('12032')
})

test('adding a box: pick a cabinet from the catalog by code', async ({ page }) => {
  await page.locator('[data-action="add"]').click()
  await expect(page.locator('.box-row')).toHaveCount(11)
  const added = row(page, 10)
  const search = added.locator('[data-field="search"]')
  await expect(search).toBeFocused()
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(page.locator('.details li')).toHaveText(['Box 11: Pick a cabinet from the catalog'])
  const options = page.locator('#combobox-list .combobox-option')
  await expect(page.locator('#combobox-list')).toBeVisible()
  await expect(options).toHaveCount(41)
  await expect(page.locator('#combobox-list .combobox-more')).toContainText('134 more')

  await search.fill('3042')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toContainText('3042')
  await expect(options.first()).toContainText('30 × 12 × 42 in')
  await search.press('Enter')
  await expect(page.locator('#combobox-list')).toBeHidden()
  await expect(search).toHaveValue('3042')
  await expect(added.locator('[data-role="dims"]')).toHaveText('30 × 12 × 42 in')
  await expect(added.locator('[data-field="qty"]')).toBeFocused()
  await expect(badge(page)).toHaveText('2 containers')
  await expect(page.locator('.legend-row').nth(10)).toContainText('3042')

  await added.locator('[data-action="remove"]').click()
  await expect(page.locator('.box-row')).toHaveCount(10)
})

test('adding a box: search by size, or enter a custom size', async ({ page }) => {
  await page.locator('[data-action="add"]').click()
  const added = row(page, 10)
  const search = added.locator('[data-field="search"]')
  const options = page.locator('#combobox-list .combobox-option')
  await search.fill('36 x 12 x 30')
  // Sizes typed in width x depth x height order rank first: 3630 is 36 wide, 12 deep, 30 tall.
  await expect(options.first().locator('.option-label')).toHaveText('3630')
  await expect(options.nth(1).locator('.option-label')).toHaveText('3036')
  await search.press('ArrowDown')
  await options.nth(1).click()
  await expect(search).toHaveValue('3036')
  await expect(added.locator('[data-role="dims"]')).toHaveText('30 × 12 × 36 in')
  await expect(badge(page)).toHaveText('2 containers')

  await search.fill('Crate')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveText('Custom size "Crate"')
  await options.first().click()
  await expect(added).toHaveAttribute('data-kind', 'custom')
  await expect(search).toHaveValue('Crate')
  await expect(added.locator('[data-field="l"]')).toBeFocused()
  // A custom box starts from the size that was picked, so the order still packs.
  await expect(added.locator('[data-field="l"]')).toHaveValue('30')
  await expect(added.locator('[data-field="h"]')).toHaveValue('36')
  await expect(badge(page)).toHaveText('2 containers')
  await added.locator('[data-field="h"]').fill('')
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(page.locator('.details li')).toHaveText(['Crate H: Enter a number'])
  await added.locator('[data-field="h"]').fill('10')
  await expect(badge(page)).toHaveText('2 containers')
  await expect(page.locator('.legend-row').nth(10)).toContainText('Crate')

  // Blurring the name in a custom row keeps the typed name.
  await search.fill('Crate B')
  await search.press('Tab')
  await expect(page.locator('.legend-row').nth(10)).toContainText('Crate B')
  await page.reload()
  await expect(row(page, 10).locator('[data-field="search"]')).toHaveValue('Crate B')
})

test('the table view lists every placement in every container', async ({ page }) => {
  await expect(page.locator('.stage-table')).toBeHidden()
  await page.locator('[data-mode="table"]').click()
  await expect(page.locator('.stage-table')).toBeVisible()
  await expect(page.locator('.stage-3d')).toBeHidden()
  await expect(page.locator('[data-role="container-switch"]')).toBeHidden()
  await expect(page.locator('tbody tr')).toHaveCount(150)
  await expect(page.locator('tbody tr').first()).toContainText('P249624')
  await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('1')
  await expect(page.locator('tbody tr').last().locator('td').first()).toHaveText('2')
  await expect(page.locator('[data-role="summary"]')).toContainText('150 placed in 2 containers')
  await page.locator('[data-mode="3d"]').click()
  await expect(page.locator('.stage-3d canvas')).toBeVisible()
})

test('the container switcher and the container list select what the 3D view shows', async ({
  page,
}) => {
  const stage = page.locator('.stage-3d')
  const label = page.locator('[data-role="container-label"]')
  await expect(progress(page)).toBeHidden()
  await expect(label).toHaveText('Container 1 of 2')
  await expect(stage).toHaveAttribute('data-boxes', '66')
  await expect(page.locator('.legend-row').first()).toContainText('in container 1')

  await page.locator('[data-action="next-container"]').click()
  await expect(label).toHaveText('Container 2 of 2')
  await expect(stage).toHaveAttribute('data-container', '1')
  await expect(stage).toHaveAttribute('data-boxes', '84')
  await expect(page.locator('.container-row.selected')).toContainText('Container 2')
  await expect(page.locator('.legend-row').first()).toContainText('in container 2')

  await page.locator('[data-action="next-container"]').click()
  await expect(label).toHaveText('Container 1 of 2')
  await page.locator('.container-row').nth(1).click()
  await expect(label).toHaveText('Container 2 of 2')

  // Fewer containers than the selected index: the view falls back to the last one.
  await page.locator('[data-field="containerType"]').selectOption('40ft-hc')
  await expect(badge(page)).toHaveText('Fits')
  await expect(page.locator('[data-role="container-switch"]')).toBeHidden()
  await expect(stage).toHaveAttribute('data-container', '0')
  await expect(stage).toHaveAttribute('data-boxes', '150')
})

test('the layer slider hides boxes above the chosen height', async ({ page }) => {
  const slider = page.locator('[data-field="layer"]')
  const label = page.locator('[data-role="layer-label"]')
  await expect(progress(page)).toBeHidden()
  await expect(label).toHaveText('Layer: all')
  await expect(slider).toHaveAttribute('max', '942')

  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '0'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(label).toHaveText('Layer: up to 0 in')
  const floorBoxes = Number(await page.locator('.stage-3d').getAttribute('data-boxes'))
  expect(floorBoxes).toBeGreaterThan(0)
  expect(floorBoxes).toBeLessThan(66)

  await slider.evaluate((el: HTMLInputElement) => {
    el.value = el.max
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(label).toHaveText('Layer: all')
  await expect(page.locator('.stage-3d')).toHaveAttribute('data-boxes', '66')
})

test('hovering a legend or sidebar row highlights that box type', async ({ page }) => {
  const stage = page.locator('.stage-3d')
  await page.locator('.legend-row').nth(2).hover()
  await expect(stage).toHaveAttribute('data-hover', 'db18')
  await page.locator('.box-row').nth(1).hover()
  await expect(stage).toHaveAttribute('data-hover', '18')
  await page.locator('.status').hover()
  await expect(stage).toHaveAttribute('data-hover', '')
})

test('the optimizer runs by itself after an edit and the result stays consistent', async ({
  page,
}) => {
  await expect(progress(page)).toBeHidden()
  await qty(page, 5).fill('40')
  await expect(page.locator('.status')).not.toHaveClass(/stale/)
  // Whatever the optimizer finds, every box ends up in some container and the view agrees.
  await expect(progress(page)).toBeHidden({ timeout: 15_000 })
  await expect(badge(page)).toHaveText(/^\d+ containers$/)
  await expect(page.locator('[data-stat="placed"]')).toHaveText('160 / 160')
  const containers = Number(await page.locator('[data-stat="containers"]').textContent())
  await expect(page.locator('.container-row')).toHaveCount(containers)
  await expect(page.locator('[data-role="container-label"]')).toHaveText(
    `Container 1 of ${containers}`,
  )
})

test('the Excel export imports back: order, container, unit and upright setting', async ({
  page,
}) => {
  await page.locator('[data-field="containerType"]').selectOption('40ft-hc')
  await page.locator('[data-field="keepUpright"]').check()
  await expect(badge(page)).toHaveText('Fits')
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="export-excel"]').click()
  const path = (await (await downloadPromise).path())!

  await page.locator('[data-field="containerType"]').selectOption('20ft')
  await page.locator('[data-field="keepUpright"]').uncheck()
  await qty(page, 0).fill('3')
  await row(page, 9).locator('[data-action="remove"]').click()
  await expect(page.locator('.box-row')).toHaveCount(9)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('[data-field="import-file"]').setInputFiles(path)
  await expect(page.locator('[data-role="footer-hint"]')).toContainText(
    'Imported 10 rows, 150 boxes',
  )
  await expect(page.locator('.box-row')).toHaveCount(10)
  await expect(qty(page, 0)).toHaveValue('20')
  await expect(page.locator('[data-field="containerType"]')).toHaveValue('40ft-hc')
  await expect(page.locator('[data-field="keepUpright"]')).toBeChecked()
  await expect(badge(page)).toHaveText('Fits')
  // The message stays until the next change.
  await expect(page.locator('[data-role="footer-hint"]')).toContainText('Imported 10 rows')
  await qty(page, 0).fill('21')
  await expect(page.locator('[data-role="footer-hint"]')).toHaveText('Results update as you type')
})

test('Import reads an order from the template or a CSV file', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="template"]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('contsim-order-template.xlsx')
  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('[data-field="import-file"]').setInputFiles((await download.path())!)
  await expect(page.locator('[data-role="footer-hint"]')).toContainText('Imported 3 rows, 7 boxes')
  await expect(page.locator('.box-row')).toHaveCount(3)
  await expect(row(page, 0).locator('[data-field="search"]')).toHaveValue('3036')
  await expect(row(page, 2)).toHaveAttribute('data-kind', 'custom')
  await expect(row(page, 2).locator('[data-field="search"]')).toHaveValue('Crate')
  await expect(row(page, 2).locator('[data-field="l"]')).toHaveValue('40')
  await expect(badge(page)).toHaveText('Fits')

  // Other column names, a size in millimetres, a duplicate and an unknown row.
  const csv =
    'Item;Quantity;Width (mm);Depth (mm);Height (mm)\n3036;4;;;\n3036;1;;;\nCrate;2;1016;762;508\nNope;1;;;\n'
  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('[data-field="import-file"]').setInputFiles({
    name: 'order.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  const hint = page.locator('[data-role="footer-hint"]')
  await expect(hint).toContainText('Imported 2 rows, 7 boxes, from order.csv')
  await expect(hint).toContainText('3036 appears more than once')
  await expect(hint).toContainText('"Nope" is not in the catalog')
  await expect(page.locator('.box-row')).toHaveCount(2)
  await expect(qty(page, 0)).toHaveValue('5')
  await expect(row(page, 1).locator('[data-field="l"]')).toHaveValue('40')
  await expect(row(page, 1).locator('[data-field="w"]')).toHaveValue('30')
  await expect(badge(page)).toHaveText('Fits')
})

test('Export Excel downloads a workbook with summary, containers, boxes and placements', async ({
  page,
}) => {
  await expect(progress(page)).toBeHidden()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="export-excel"]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('contsim-packing.xlsx')
  const parts = unzip(new Uint8Array(await readFile((await download.path())!)))

  expect(text(parts.get('xl/workbook.xml')!)).toContain(
    '<sheet name="Summary" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Containers" sheetId="2" r:id="rId2"/>' +
      '<sheet name="Boxes" sheetId="3" r:id="rId3"/>' +
      '<sheet name="Placements" sheetId="4" r:id="rId4"/>',
  )
  const summary = readSheet(text(parts.get('xl/worksheets/sheet1.xml')!))
  expect(summary).toContainEqual(['Status', '2 containers'])
  expect(summary).toContainEqual(['Container type', '20 ft'])
  expect(summary).toContainEqual(['Container length (in)', 232.2])
  expect(summary).toContainEqual(['Containers needed', 2])
  expect(summary).toContainEqual(['Boxes placed', 150])
  const containers = readSheet(text(parts.get('xl/worksheets/sheet2.xml')!))
  expect(containers).toHaveLength(3)
  expect(containers[1]!.slice(0, 2)).toEqual([1, 66])
  expect(containers[2]!.slice(0, 2)).toEqual([2, 84])
  const boxes = readSheet(text(parts.get('xl/worksheets/sheet3.xml')!))
  expect(boxes).toHaveLength(11)
  expect(boxes[1]!.slice(1, 9)).toEqual(['36', '#f59e0b', 36, 24, 34.5, 20, 20, 0])
  const placements = readSheet(text(parts.get('xl/worksheets/sheet4.xml')!))
  expect(placements).toHaveLength(151)
  expect(placements[1]!.slice(0, 6)).toEqual([1, 1, 'P249624', 0, 0, 0])
  expect([...(placements[1]!.slice(6, 9) as number[])].sort((a, b) => a - b)).toEqual([24, 24, 96])
  expect(placements[150]![0]).toBe(2)
})

test('Export Excel waits for the inputs to be valid', async ({ page }) => {
  const button = page.locator('[data-action="export-excel"]')
  await expect(button).toBeEnabled()
  await qty(page, 0).fill('2.5')
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(button).toBeDisabled()
  await qty(page, 0).fill('20')
  await expect(button).toBeEnabled()
})

test('importing a file without an order in it changes nothing and says so', async ({ page }) => {
  await page.locator('[data-field="import-file"]').setInputFiles({
    name: 'notes.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('just some notes\nnothing here'),
  })
  await expect(page.locator('[data-role="footer-hint"]')).toContainText('notes.csv: No header row')
  await expect(page.locator('[data-role="footer-hint"]')).toHaveClass(/error/)
  await expect(page.locator('.box-row')).toHaveCount(10)
  await expect(qty(page, 0)).toHaveValue('20')
})

test('smoke: fits in one, grows into two, a bigger container takes it all, export', async ({
  page,
}) => {
  await setQuantities(page, ONE_CONTAINER)
  await expect(badge(page)).toHaveText('Fits')
  // Add base cabinets one at a time until a second container opens.
  const base36 = row(page, 0)
  for (let i = 0; i < 60 && (await badge(page).textContent()) === 'Fits'; i++) {
    await base36.locator('[data-action="inc"]').click()
    await expect(page.locator('.status')).not.toHaveClass(/stale/)
  }
  await expect(badge(page)).toHaveText('2 containers')
  await expect(progress(page)).toBeHidden({ timeout: 15_000 })
  await expect(page.locator('.container-row')).toHaveCount(2)

  await page.locator('[data-field="containerType"]').selectOption('40ft')
  await expect(badge(page)).toHaveText('Fits')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="export-excel"]').click()
  expect((await downloadPromise).suggestedFilename()).toBe('contsim-packing.xlsx')
})
