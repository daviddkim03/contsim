import { expect, test, type Page } from '@playwright/test'

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
