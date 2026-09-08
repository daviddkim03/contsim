import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readSheet, text, unzip } from '../helpers/unzip'

const badge = (page: Page) => page.locator('.badge')
const row = (page: Page, index: number) => page.locator('.box-row').nth(index)
const qty = (page: Page, index: number) => row(page, index).locator('[data-field="qty"]')
const search = (page: Page, index: number) => row(page, index).locator('[data-field="search"]')
const progress = (page: Page) => page.locator('[data-role="progress"]')
const hint = (page: Page) => page.locator('[data-role="footer-hint"]')
const options = (page: Page) => page.locator('#combobox-list .combobox-option')
const dialog = (page: Page) => page.locator('.import-dialog')

/**
 * Example rows: 0 "18" (28), 1 "36" (28), 2 "3036" (42), 3 "2442" (28),
 * 4 "P249624" (14). 140 cabinets, which need two 20 ft containers (62 + 78).
 */
async function setQuantities(page: Page, values: number[]) {
  for (const [i, v] of values.entries()) await qty(page, i).fill(String(v))
}

/** Half the example: fits in one 20 ft container. */
const ONE_CONTAINER = [14, 14, 21, 14, 7]

type FileSource = { name: string; mimeType: string; buffer: Buffer } | string

/** Clicks Import and hands the file picker a file, the way a user would. */
async function pickFile(page: Page, file: FileSource) {
  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-action="import"]').click()
  await (await chooser).setFiles(file)
}

/** Picks a file and confirms the import dialog, optionally choosing the file's unit. */
async function importFile(page: Page, file: FileSource, unit?: string) {
  await pickFile(page, file)
  await expect(dialog(page)).toBeVisible()
  if (unit) await dialog(page).locator('[data-field="import-unit"]').selectOption(unit)
  await dialog(page).locator('[data-action="confirm"]').click()
  await expect(dialog(page)).toBeHidden()
}

const csvFile = (name: string, body: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(body),
})

/** Turns a row into a custom box of the given size. */
async function makeCustom(page: Page, index: number, name: string, dims: [string, string, string]) {
  const box: Locator = row(page, index)
  await search(page, index).fill(name)
  await options(page).filter({ hasText: 'Custom size' }).click()
  for (const [i, field] of (['l', 'w', 'h'] as const).entries()) {
    await box.locator(`[data-field="${field}"]`).fill(dims[i]!)
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('opens on the example order, which needs two containers', async ({ page }) => {
  await expect(page).toHaveTitle('contsim')
  await expect(badge(page)).toHaveText('2 containers')
  await expect(page.locator('.message')).toHaveText('All 140 boxes placed in 2 × 20 ft containers.')
  await expect(page.locator('[data-stat="containers"]')).toHaveText('2')
  await expect(page.locator('[data-stat="placed"]')).toHaveText('140 / 140')
  await expect(page.locator('.box-row')).toHaveCount(5)
  await expect(page.locator('.legend-row')).toHaveCount(5)
  await expect(page.locator('.legend-row.short')).toHaveCount(0)
  await expect(page.locator('.container-row')).toHaveCount(2)
  await expect(page.locator('.container-row.selected')).toContainText('Container 1')
  await expect(page.locator('.stage-3d canvas')).toBeVisible()
  await expect(progress(page)).toBeHidden()
  await expect(page.locator('.stage-3d')).toHaveAttribute('data-boxes', '62')
})

test('quantities update the result live and survive a reload', async ({ page }) => {
  await setQuantities(page, ONE_CONTAINER)
  await expect(badge(page)).toHaveText('Fits')
  await expect(page.locator('.message')).toHaveText('All 70 boxes placed in one 20 ft container.')
  await expect(page.locator('.container-row')).toHaveCount(0)

  await page.reload()
  await expect(qty(page, 0)).toHaveValue('14')
  await expect(qty(page, 2)).toHaveValue('21')
  await expect(badge(page)).toHaveText('Fits')
})

test('steppers change a quantity by one and stop at zero', async ({ page }) => {
  const base = row(page, 1)
  await base.locator('[data-action="inc"]').click()
  await expect(qty(page, 1)).toHaveValue('29')
  await qty(page, 1).fill('1')
  await base.locator('[data-action="dec"]').click()
  await base.locator('[data-action="dec"]').click()
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
    '3036 quantity: Enter a whole number',
  ])

  await length.fill('232.2')
  await qty(page, 2).fill('42')
  await expect(badge(page)).toHaveText('2 containers')
})

test('a box that fits in no container is impossible, and the rest still ships', async ({
  page,
}) => {
  await page.locator('[data-field="containerType"]').selectOption('custom')
  await page.locator('[data-field="container.h"]').fill('60')
  await page.locator('[data-field="keepUpright"]').check()
  await expect(badge(page)).toHaveText('Impossible')
  await expect(page.locator('.message')).toHaveText(
    'P249624 (24 in x 24 in x 96 in) does not fit in the container in any allowed orientation.',
  )
  await expect(page.locator('.details li')).toHaveText([
    'P249624: 14 boxes cannot ship in this container',
    'Everything else fits in 4 containers.',
  ])
  await expect(page.locator('.legend-row.short .legend-count')).toContainText('0 / 14')

  // Too flat for anything at all.
  await page.locator('[data-field="container.h"]').fill('10')
  await expect(page.locator('.message')).toContainText('18 (18 in x 24 in x 34.5 in)')
  await expect(page.locator('.details li')).toHaveCount(5)
  await expect(page.locator('[data-stat="containers"]')).toHaveText('0')
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
    'All 140 boxes placed in one 40 ft high cube container.',
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

test('switching the unit converts every size, typed ones included', async ({ page }) => {
  await makeCustom(page, 4, 'Crate', ['40', '30', '20'])
  await expect(badge(page)).toHaveText(/containers|Fits/)

  await page.locator('[data-field="unit"]').selectOption('mm')
  const crate = row(page, 4)
  await expect(crate.locator('[data-field="l"]')).toHaveValue('1016')
  await expect(crate.locator('[data-field="w"]')).toHaveValue('762')
  await expect(crate.locator('[data-field="h"]')).toHaveValue('508')
  // A catalog cabinet is recomputed from the catalog: 18 x 24 x 34.5 in.
  await expect(row(page, 0).locator('[data-role="dims"]')).toHaveText('457.2 × 609.6 × 876.3 mm')
  await expect(page.locator('.legend-row').first()).toContainText('457.2 × 609.6 × 876.3 mm')

  await page.locator('[data-field="unit"]').selectOption('in')
  await expect(crate.locator('[data-field="l"]')).toHaveValue('40')
  await expect(row(page, 0).locator('[data-role="dims"]')).toHaveText('18 × 24 × 34.5 in')
})

test('adding a box: pick a cabinet from the catalog by code', async ({ page }) => {
  await page.locator('[data-action="add"]').click()
  await expect(page.locator('.box-row')).toHaveCount(6)
  const added = row(page, 5)
  await expect(search(page, 5)).toBeFocused()
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(page.locator('.details li')).toHaveText(['Box 6: Pick a cabinet from the catalog'])
  await expect(page.locator('#combobox-list')).toBeVisible()
  // The rows that are fine keep showing their size while this one is unfinished.
  await expect(page.locator('.legend-row').first()).toContainText('18 × 24 × 34.5 in')
  await expect(page.locator('.legend-row').nth(5)).toContainText('No cabinet picked yet')
  // The five placeholder cabinets, plus the entry that makes a custom box.
  await expect(options(page)).toHaveCount(6)
  await expect(page.locator('#combobox-list .combobox-more')).toHaveCount(0)

  await search(page, 5).fill('3036')
  await expect(options(page)).toHaveCount(2)
  await expect(options(page).first()).toContainText('3036')
  await expect(options(page).first()).toContainText('30 × 12 × 36 in')
  await search(page, 5).press('Enter')
  await expect(page.locator('#combobox-list')).toBeHidden()
  await expect(search(page, 5)).toHaveValue('3036')
  await expect(added.locator('[data-role="dims"]')).toHaveText('30 × 12 × 36 in')
  await expect(added.locator('[data-field="qty"]')).toBeFocused()
  await expect(badge(page)).toHaveText('2 containers')

  await added.locator('[data-action="remove"]').click()
  await expect(page.locator('.box-row')).toHaveCount(5)
})

test('adding a box: search by size, or enter a custom size', async ({ page }) => {
  await page.locator('[data-action="add"]').click()
  await search(page, 5).fill('30 12 36')
  await expect(options(page).first().locator('.option-label')).toHaveText('3036')
  await options(page).first().click()
  await expect(search(page, 5)).toHaveValue('3036')

  await makeCustom(page, 5, 'Crate', ['10', '10', '10'])
  await expect(row(page, 5)).toHaveAttribute('data-kind', 'custom')
  await expect(search(page, 5)).toHaveValue('Crate')
  await expect(badge(page)).toHaveText('2 containers')
  await expect(page.locator('.legend-row').nth(5)).toContainText('Crate')

  // Blurring the name in a custom row keeps the typed name.
  await search(page, 5).fill('Crate B')
  await search(page, 5).press('Tab')
  await expect(page.locator('.legend-row').nth(5)).toContainText('Crate B')
  await page.reload()
  await expect(search(page, 5)).toHaveValue('Crate B')
})

test('a custom box can be saved into the catalog and taken back out', async ({ page }) => {
  await page.locator('[data-action="add"]').click()
  await makeCustom(page, 5, 'Crate', ['40', '30', '20'])
  const added = row(page, 5)
  const star = added.locator('[data-action="toggle-catalog"]')
  await expect(star).toBeVisible()
  await expect(star).toHaveAttribute('title', 'Save to the catalog')
  // Built-in cabinets are already in the catalog, so they have no star.
  await expect(row(page, 0).locator('[data-action="toggle-catalog"]')).toBeHidden()

  await star.click()
  await expect(hint(page)).toHaveText('Crate saved to the catalog.')
  await expect(added).toHaveAttribute('data-kind', 'catalog')
  await expect(added.locator('[data-role="dims"]')).toHaveText('40 × 30 × 20 in')
  await expect(star).toHaveAttribute('title', 'Remove from the catalog')

  // It is in the picker from now on, marked as one of the user's own.
  await page.reload()
  await page.locator('[data-action="add"]').click()
  await search(page, 6).fill('crate')
  await expect(options(page).first().locator('.option-label')).toHaveText('Crate')
  await expect(options(page).first().locator('.option-tag')).toHaveText('saved')
  await search(page, 6).press('Escape')
  await row(page, 6).locator('[data-action="remove"]').click()

  await row(page, 5).locator('[data-action="toggle-catalog"]').click()
  await expect(hint(page)).toHaveText('Crate is no longer in the catalog.')
  await expect(row(page, 5)).toHaveAttribute('data-kind', 'custom')
  await expect(row(page, 5).locator('[data-field="l"]')).toHaveValue('40')
  await expect(badge(page)).toHaveText('2 containers')
})

test('saving to the catalog refuses a name that is taken or a box without a size', async ({
  page,
}) => {
  await page.locator('[data-action="add"]').click()
  await makeCustom(page, 5, '3036', ['10', '10', '10'])
  await row(page, 5).locator('[data-action="toggle-catalog"]').click()
  await expect(hint(page)).toHaveText('3036 is already in the catalog.')
  await expect(hint(page)).toHaveClass(/error/)
  await expect(row(page, 5)).toHaveAttribute('data-kind', 'custom')

  await row(page, 5).locator('[data-field="h"]').fill('')
  await row(page, 5).locator('[data-action="toggle-catalog"]').click()
  await expect(hint(page)).toHaveText('Give the box a size before saving it to the catalog.')
})

test('the table view lists every placement in every container', async ({ page }) => {
  await expect(page.locator('.stage-table')).toBeHidden()
  await page.locator('[data-mode="table"]').click()
  await expect(page.locator('.stage-table')).toBeVisible()
  await expect(page.locator('.stage-3d')).toBeHidden()
  await expect(page.locator('[data-role="container-switch"]')).toBeHidden()
  await expect(page.locator('tbody tr')).toHaveCount(140)
  await expect(page.locator('tbody tr').first()).toContainText('P249624')
  await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('1')
  await expect(page.locator('tbody tr').last().locator('td').first()).toHaveText('2')
  await expect(page.locator('[data-role="summary"]')).toContainText('140 placed in 2 containers')
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
  await expect(stage).toHaveAttribute('data-boxes', '62')
  await expect(page.locator('.legend-row').first()).toContainText('in container 1')

  await page.locator('[data-action="next-container"]').click()
  await expect(label).toHaveText('Container 2 of 2')
  await expect(stage).toHaveAttribute('data-container', '1')
  await expect(stage).toHaveAttribute('data-boxes', '78')
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
  await expect(stage).toHaveAttribute('data-boxes', '140')
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
  expect(floorBoxes).toBeLessThan(62)

  await slider.evaluate((el: HTMLInputElement) => {
    el.value = el.max
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(label).toHaveText('Layer: all')
  await expect(page.locator('.stage-3d')).toHaveAttribute('data-boxes', '62')
})

test('hovering a legend or sidebar row highlights that box type', async ({ page }) => {
  const stage = page.locator('.stage-3d')
  await page.locator('.legend-row').nth(2).hover()
  await expect(stage).toHaveAttribute('data-hover', '3036')
  await page.locator('.box-row').nth(1).hover()
  await expect(stage).toHaveAttribute('data-hover', '36')
  await page.locator('.status').hover()
  await expect(stage).toHaveAttribute('data-hover', '')
})

test('the optimizer runs by itself after an edit and the result stays consistent', async ({
  page,
}) => {
  await expect(progress(page)).toBeHidden()
  await qty(page, 2).fill('60')
  await expect(page.locator('.status')).not.toHaveClass(/stale/)
  await expect(progress(page)).toBeHidden({ timeout: 15_000 })
  await expect(badge(page)).toHaveText(/^\d+ containers$/)
  await expect(page.locator('[data-stat="placed"]')).toHaveText('158 / 158')
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
  await row(page, 4).locator('[data-action="remove"]').click()
  await expect(page.locator('.box-row')).toHaveCount(4)

  // The workbook states its own unit, so the dialog does not ask for one.
  await pickFile(page, path)
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).locator('[data-role="unit-row"]')).toBeHidden()
  await expect(dialog(page).locator('[data-role="counts"]')).toHaveText(
    '5 box rows, 140 boxes. Replaces the current 4 rows.',
  )
  await dialog(page).locator('[data-action="confirm"]').click()

  await expect(hint(page)).toContainText('Imported 5 rows, 140 boxes')
  await expect(page.locator('.box-row')).toHaveCount(5)
  await expect(qty(page, 0)).toHaveValue('28')
  await expect(page.locator('[data-field="containerType"]')).toHaveValue('40ft-hc')
  await expect(page.locator('[data-field="keepUpright"]')).toBeChecked()
  await expect(badge(page)).toHaveText('Fits')
  // The message stays until the next change.
  await expect(hint(page)).toContainText('Imported 5 rows')
  await qty(page, 0).fill('29')
  await expect(hint(page)).toHaveText('Results update as you type')
})

test('Import reads an order from the template and asks which unit it is in', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="template"]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('contsim-order-template.xlsx')
  // Saved under its real name, because the dialog shows the name of the file picked.
  const path = test.info().outputPath('contsim-order-template.xlsx')
  await download.saveAs(path)

  await pickFile(page, path)
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).locator('[data-role="file"]')).toHaveText('contsim-order-template.xlsx')
  await expect(dialog(page).locator('[data-field="import-unit"]')).toHaveValue('in')
  await expect(dialog(page).locator('[data-role="counts"]')).toHaveText(
    '3 box rows, 7 boxes. Replaces the current 5 rows.',
  )
  // Backing out changes nothing.
  await dialog(page).locator('[data-action="cancel"]').click()
  await expect(page.locator('.box-row')).toHaveCount(5)

  await importFile(page, path)
  await expect(hint(page)).toContainText('Imported 3 rows, 7 boxes')
  await expect(page.locator('.box-row')).toHaveCount(3)
  await expect(search(page, 0)).toHaveValue('3036')
  await expect(row(page, 2)).toHaveAttribute('data-kind', 'custom')
  await expect(search(page, 2)).toHaveValue('Crate')
  await expect(row(page, 2).locator('[data-field="l"]')).toHaveValue('40')
  await expect(badge(page)).toHaveText('Fits')
})

test('the unit chosen at import decides what the numbers mean', async ({ page }) => {
  const csv = 'Code,Qty,W,D,H\nCrate,2,40,30,20\n'
  await importFile(page, csvFile('order.csv', csv), 'mm')
  await expect(page.locator('[data-field="unit"]')).toHaveValue('mm')
  await expect(row(page, 0).locator('[data-field="l"]')).toHaveValue('40')
  // The container came along into millimetres.
  await expect(page.locator('[data-field="container.l"]')).toHaveValue('5898')

  await importFile(page, csvFile('order.csv', csv), 'in')
  await expect(page.locator('[data-field="unit"]')).toHaveValue('in')
  await expect(row(page, 0).locator('[data-field="l"]')).toHaveValue('40')
  await expect(page.locator('[data-field="container.l"]')).toHaveValue('232.2')
})

test('Import reads a CSV with its own units, other column names and rows to skip', async ({
  page,
}) => {
  const csv =
    'Item;Quantity;Width (mm);Depth (mm);Height (mm)\n3036;4;;;\n3036;1;;;\nCrate;2;1016;762;508\nNope;1;;;\n'
  await pickFile(page, csvFile('order.csv', csv))
  await expect(dialog(page)).toBeVisible()
  // The headers name millimetres, so that is what the dialog offers.
  await expect(dialog(page).locator('[data-field="import-unit"]')).toHaveValue('mm')
  await expect(dialog(page).locator('[data-role="counts"]')).toHaveText(
    '2 box rows, 7 boxes. 1 row will be skipped. Replaces the current 5 rows.',
  )
  await dialog(page).locator('[data-action="confirm"]').click()

  await expect(hint(page)).toContainText('Imported 2 rows, 7 boxes, from order.csv')
  await expect(hint(page)).toContainText('3036 appears more than once')
  await expect(hint(page)).toContainText('"Nope" is not in the catalog')
  await expect(page.locator('.box-row')).toHaveCount(2)
  await expect(qty(page, 0)).toHaveValue('5')
  await expect(page.locator('[data-field="unit"]')).toHaveValue('mm')
  await expect(row(page, 0).locator('[data-role="dims"]')).toHaveText('762 × 304.8 × 914.4 mm')
  await expect(row(page, 1).locator('[data-field="l"]')).toHaveValue('1016')
  await expect(badge(page)).toHaveText('Fits')
})

test('Export Excel waits for the inputs to be valid', async ({ page }) => {
  const button = page.locator('[data-action="export-excel"]')
  await expect(button).toBeEnabled()
  await qty(page, 0).fill('2.5')
  await expect(badge(page)).toHaveText('Fix inputs')
  await expect(button).toBeDisabled()
  await qty(page, 0).fill('28')
  await expect(button).toBeEnabled()
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
  expect(summary).toContainEqual(['Boxes placed', 140])
  const containers = readSheet(text(parts.get('xl/worksheets/sheet2.xml')!))
  expect(containers).toHaveLength(3)
  expect(containers[1]!.slice(0, 2)).toEqual([1, 62])
  expect(containers[2]!.slice(0, 2)).toEqual([2, 78])
  const boxes = readSheet(text(parts.get('xl/worksheets/sheet3.xml')!))
  expect(boxes).toHaveLength(6)
  expect(boxes[1]!.slice(1, 9)).toEqual(['18', '#f59e0b', 18, 24, 34.5, 28, 28, 0])
  const placements = readSheet(text(parts.get('xl/worksheets/sheet4.xml')!))
  expect(placements).toHaveLength(141)
  expect(placements[1]!.slice(0, 6)).toEqual([1, 1, 'P249624', 0, 0, 0])
  expect([...(placements[1]!.slice(6, 9) as number[])].sort((a, b) => a - b)).toEqual([24, 24, 96])
  expect(placements[140]![0]).toBe(2)
})

test('importing a file without an order in it changes nothing and says so', async ({ page }) => {
  await pickFile(page, csvFile('notes.csv', 'just some notes\nnothing here'))
  await expect(hint(page)).toContainText('notes.csv: No header row')
  await expect(hint(page)).toHaveClass(/error/)
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('.box-row')).toHaveCount(5)
  await expect(qty(page, 0)).toHaveValue('28')
})

test('smoke: fits in one, grows into two, a bigger container takes it all, export', async ({
  page,
}) => {
  await setQuantities(page, ONE_CONTAINER)
  await expect(badge(page)).toHaveText('Fits')
  // Add base cabinets one at a time until a second container opens.
  const base = row(page, 1)
  for (let i = 0; i < 60 && (await badge(page).textContent()) === 'Fits'; i++) {
    await base.locator('[data-action="inc"]').click()
    await expect(page.locator('.status')).not.toHaveClass(/stale/)
  }
  await expect(badge(page)).toHaveText('2 containers')
  await expect(progress(page)).toBeHidden({ timeout: 15_000 })
  await expect(page.locator('.container-row')).toHaveCount(2)
  const placed = await page.locator('[data-stat="placed"]').textContent()

  await page.locator('[data-field="containerType"]').selectOption('40ft')
  await expect(page.locator('[data-stat="containers"]')).toHaveText('1')
  await expect(page.locator('[data-stat="placed"]')).toHaveText(placed!)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-action="export-excel"]').click()
  expect((await downloadPromise).suggestedFilename()).toBe('contsim-packing.xlsx')
})
