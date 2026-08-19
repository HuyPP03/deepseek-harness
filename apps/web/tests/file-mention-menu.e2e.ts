// Web e2e scenario: the composer's @ file mention menu over a real session's
// working set. Zero model calls: a fresh workspace's blank session carries a
// live composer, and the scenario only types into it and picks. The staged
// working set exercises the host walk end to end: files and directories are
// listed (a directory row carries the trailing-slash convention), dot
// entries and the curated skip list stay out, a trailing-slash query prunes
// to the prefix subtree with the folder row first, and the pick lands the
// plain-text '@src/ ' mention in the draft.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const WS = 'mention-ws'

describe('web e2e: the @ file mention menu', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // The working set the menu must render: files and a directory, plus the
    // noise the host walk keeps out (dot entries, curated skip list).
    const ws = join(scaffold.workspaceCwd, WS)
    mkdirSync(join(ws, 'src'), { recursive: true })
    writeFileSync(join(ws, 'README.md'), 'readme\n')
    writeFileSync(join(ws, 'src/main.ts'), 'export const main = true\n')
    writeFileSync(join(ws, 'src/other.md'), 'other\n')
    writeFileSync(join(ws, '.env'), 'SECRET=1\n')
    mkdirSync(join(ws, 'node_modules'), { recursive: true })
    writeFileSync(join(ws, 'node_modules/deps.js'), '')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('lists files and directories, skips noise, prunes a trailing-slash query, and picks @src/', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-file-mention-menu'))
    await connectFreshWorkspace(page, scaffold.workspaceCwd, WS)
    const composer = page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
    await composer.click()
    await composer.press('@')
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    await menu.waitFor({ timeout: 15_000 })
    // Files AND directories: the browse listing settles with the folder row
    // (trailing-slash display form) and every file.
    await expect.poll(() => page.getByRole('option', { name: 'README.md', exact: true }).count(), { timeout: 15_000 }).toBe(1)
    // exact: the bare 'src/' substring would also match 'src/main.ts' and
    // 'src/other.md' (role-name matching is substring by default).
    await expect.poll(() => page.getByRole('option', { name: 'src/', exact: true }).count(), { timeout: 15_000 }).toBe(1)
    expect(await page.getByRole('option', { name: 'src/main.ts', exact: true }).count()).toBe(1)
    expect(await page.getByRole('option', { name: 'src/other.md', exact: true }).count()).toBe(1)
    expect(await menu.getByText('Files', { exact: true }).count()).toBe(1)
    // The noise rule: dot entries and the curated skip list stay out.
    expect(await page.getByRole('option', { name: '.env' }).count()).toBe(0)
    expect(await page.getByRole('option', { name: /node_modules/ }).count()).toBe(0)
    // A trailing-slash query prunes to the prefix: the folder row leads.
    await composer.pressSequentially('src/')
    await expect.poll(() => menu.getByRole('option').first().innerText(), { timeout: 15_000 }).toBe('src/')
    // The pick lands the plain-text directory mention in the draft.
    await page.getByRole('option', { name: 'src/', exact: true }).click()
    await expect.poll(() => composer.inputValue(), { timeout: 10_000 }).toContain('@src/ ')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
