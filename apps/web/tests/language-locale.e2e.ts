// Web e2e scenario: English is the product default. A vi-VN browser on a
// fresh Host home boots into the English surface (the navigator is never
// consulted), and the Language row still cycles all three locales —
// English, Tiếng Việt, 中文 — each explicit switch re-localizing the settings
// copy live and persisting the choice to the Host settings document.
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

describe('web e2e: the English default, and the three-locale row', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // Vietnamese browser on a fresh home: the surface stays English, because
    // the product default is en and the navigator is never consulted.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: VI_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('boots a vi-VN browser into the English surface with no stored preference', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-language-en-default'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => localStorage.getItem('oh.locale'))).toBeNull()
    await expect.poll(() => dialog.getByText('General', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(() => dialog.getByText('Language', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    // The selector pill shows the active locale's own name.
    await expect.poll(() => dialog.getByRole('button', { name: 'English' }).count(), { timeout: 5_000 }).toBe(1)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('cycles the row through 中文 and Tiếng Việt and back, persisting each explicit choice', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-language-cycle'))
    const settings = (title: string) => page.getByRole('dialog', { name: title })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = settings('Settings')
    await dialog.waitFor({ timeout: 10_000 })

    // English → 中文.
    await dialog.getByRole('button', { name: 'English' }).click()
    await page.getByRole('menuitem', { name: '中文' }).click()
    const zhDialog = settings('设置')
    await zhDialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => zhDialog.getByText('通用设置', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: zh/)

    // 中文 → Tiếng Việt.
    await zhDialog.getByRole('button', { name: '中文' }).click()
    await page.getByRole('menuitem', { name: 'Tiếng Việt' }).click()
    const viDialog = settings('Cài đặt')
    await viDialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => viDialog.getByText('Chung', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: vi/)

    // Tiếng Việt → English: the explicit preference lands back on en.
    await viDialog.getByRole('button', { name: 'Tiếng Việt' }).click()
    await page.getByRole('menuitem', { name: 'English' }).click()
    const enDialog = settings('Settings')
    await enDialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => enDialog.getByText('General', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: en/)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
