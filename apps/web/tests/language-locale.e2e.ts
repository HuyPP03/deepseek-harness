// Web e2e scenario: the first Vietnamese surface. A vi-VN browser on a fresh
// Host home boots into the Vietnamese settings surface (the provisional locale
// follows the navigator — no explicit Host preference exists yet), and the
// Language row cycles all three locales — English, Tiếng Việt, 中文 — each
// switch re-localizing the settings copy live and persisting the explicit
// choice to the Host settings document.
// Zero model calls: everything is client + persistence state on a blank
// frame, so there is no fixture and a stray stream would fail loud on the
// open llm seam.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

/** The Vietnamese browser language the scenario advertises. */
const VI_BROWSER_LOCALE = 'vi-VN'

describe('web e2e: the Vietnamese locale from the browser, and the three-locale row', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // Vietnamese browser on a fresh home: the surface follows the navigator,
    // because no explicit Host preference exists yet.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: VI_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('boots a vi-VN browser into the Vietnamese surface with no stored preference', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-language-vi-boot'))
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Cài đặt' })
    await dialog.waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
    await expect.poll(() => dialog.getByText('Chung', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(() => dialog.getByText('Ngôn ngữ', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    // The selector pill shows the active locale's own name.
    await expect.poll(() => dialog.getByRole('button', { name: 'Tiếng Việt' }).count(), { timeout: 5_000 }).toBe(1)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('cycles the row through English and 中文 and back, persisting each explicit choice', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-language-cycle'))
    const settings = (title: string) => page.getByRole('dialog', { name: title })
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
    const dialog = settings('Cài đặt')
    await dialog.waitFor({ timeout: 10_000 })

    // Tiếng Việt → English.
    await dialog.getByRole('button', { name: 'Tiếng Việt' }).click()
    await page.getByRole('menuitem', { name: 'English' }).click()
    const enDialog = settings('Settings')
    await enDialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => enDialog.getByText('General', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: en/)

    // English → 中文.
    await enDialog.getByRole('button', { name: 'English' }).click()
    await page.getByRole('menuitem', { name: '中文' }).click()
    const zhDialog = settings('设置')
    await zhDialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => zhDialog.getByText('通用设置', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: zh/)

    // 中文 → Tiếng Việt: the explicit preference lands back on vi.
    await zhDialog.getByRole('button', { name: '中文' }).click()
    await page.getByRole('menuitem', { name: 'Tiếng Việt' }).click()
    const viDialog = settings('Cài đặt')
    await viDialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => viDialog.getByText('Chung', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: vi/)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
