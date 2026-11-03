import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { decodePng, readPngInfo } from '../src/lib/png'

async function exportAndRead(page: Page) {
  await expect(page.getByTestId('preview-status')).toContainText('Preview ready')
  const downloadPromise = page.waitForEvent('download', { timeout: 200_000 })
  await page.getByRole('button', { name: 'Export PNG' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^design_[\d.]+x[\d.]+in_300dpi\.png$/)
  const bytes = new Uint8Array(await readFile((await download.path())!))
  await download.saveAs(`test-results/${download.suggestedFilename()}`)
  const info = readPngInfo(bytes)!
  const image = await decodePng(bytes)
  let semi = 0
  let opaque = 0
  let hidden = 0
  for (let i = 3; i < image.data.length; i += 4) {
    const a = image.data[i]
    if (a > 0 && a < 255) semi++
    if (a === 255) opaque++
    if (a === 0 && (image.data[i - 3] | image.data[i - 2] | image.data[i - 1]) !== 0) hidden++
  }
  // No color hiding under transparent pixels, and an embedded sRGB ICC profile.
  expect(hidden).toBe(0)
  expect(info.iccProfileName).toBe('sRGB')
  await expect(page.getByTestId('export-status')).toContainText('Exported')
  return { name: download.suggestedFilename(), info, image, semi, opaque }
}

async function chooseGarment(page: Page) {
  await page.getByLabel('Store').selectOption({ label: 'Aviva Dallas' })
  const garment = page.getByLabel('Garment', { exact: true })
  const option = garment.locator('option', { hasText: /^Gildan 5000 Heavy Cotton Tee/ }).first()
  await garment.selectOption({ value: (await option.getAttribute('value'))! })
  await page.getByLabel('Color', { exact: true }).selectOption({ label: 'Black' })
  await page.getByLabel('Size', { exact: true }).selectOption({ label: 'L' })
  await page.getByLabel('Placement', { exact: true }).selectOption({ label: 'Adult full front' })
}

test('smoke: sample PNG, black Gildan 5000 L, full front, Horror / metal -> 3300 px, binary alpha', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByLabel('Upload artwork').setInputFiles('samples/shadow.png')
  await chooseGarment(page)
  await page.getByLabel('Describe the look you want').fill('horror skull art for a black tee, let the black become the shirt')
  await page.getByRole('button', { name: 'Apply look' }).click()
  await expect(page.getByLabel('Aesthetic preset')).toHaveValue('horror-metal')
  const applied = page.getByRole('heading', { name: 'What I applied' }).locator('xpath=following-sibling::ul[1]')
  await expect(applied).toBeVisible()
  expect(await applied.locator('li').count()).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: 'Tips to tweak' }).locator('xpath=following-sibling::ul[1]')).toBeVisible()
  await expect(page.getByLabel('Print width (inches)')).toHaveValue(/^11(\.0+)?$/)

  const out = await exportAndRead(page)
  expect(out.info.width).toBe(3300) // 11 in x 300
  expect(out.image.width).toBe(3300)
  expect(out.info.colorType).toBe(6) // RGBA
  expect(out.info.dpiX).toBeCloseTo(300, 0) // pHYs
  expect(out.info.hasSRGB).toBe(true)
  expect(out.semi).toBe(0) // only 0 or 255 alpha
  expect(out.opaque).toBeGreaterThan(1000)
  // The default upscaler is the AI model; make sure it really ran instead of falling back.
  await expect(page.locator('dt', { hasText: 'Upscaled with' }).locator('xpath=following-sibling::dd[1]')).toHaveText('Real-ESRGAN')
  expect(errors).toEqual([])
})

const samples: { file: string; setup: (page: Page) => Promise<void> }[] = [
  {
    file: 'samples/logo-600.jpg',
    setup: async (page) => {
      await page.getByLabel('Remove background (flood fill from edges)').check()
    },
  },
  {
    file: 'samples/photo.jpg',
    setup: async (page) => {
      await page.getByLabel('Aesthetic preset').selectOption({ label: 'Halftone photo / screen-tone' })
    },
  },
  {
    file: 'samples/shadow.png',
    setup: async (page) => {
      await page.getByLabel('Halftone', { exact: true }).check()
    },
  },
]

for (const sample of samples) {
  test(`sample exports cleanly: ${sample.file}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    await page.getByLabel('Upload artwork').setInputFiles(sample.file)
    await chooseGarment(page)
    await sample.setup(page)
    await page.getByLabel('Lanczos (fast)').check()
    const widthIn = Number(await page.getByLabel('Print width (inches)').inputValue())
    const out = await exportAndRead(page)
    expect(out.image.width).toBe(Math.round(widthIn * 300))
    expect(out.info.dpiX).toBeCloseTo(300, 0)
    expect(out.semi).toBe(0)
    expect(out.opaque).toBeGreaterThan(1000)
    expect(errors).toEqual([])
  })
}
