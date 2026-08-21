// Keyless browser regression for the file inspector seat: a chat file link
// (the read row's summary) selects the file, opens the details column at the
// inspector's default width, and streams the real file bytes through the raw
// channel. A second selection remounts the inspector on the next file, and
// the panel closes from its own header.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const MODE = webSnapshotMode()

/** Last AppFrame grid track in CSS pixels. */
async function detailsTrack(page: Page): Promise<number> {
  return await appFrame(page).evaluate((element) => {
    const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
    return Number.parseFloat(tracks.at(-1) ?? 'NaN')
  })
}

/** AppFrame is the only product element with an inline grid track template. */
function appFrame(page: Page) {
  return page.locator('[style*="grid-template-columns"]').first()
}

describe.skipIf(MODE === 'record')('web e2e: file inspector seat opens from chat file links', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const seed = await readFile(FIXTURE, 'utf8')
    scaffold = await launchWebScaffold({})
    // The seeded session's cwd is the scaffold workspace root; its read rows
    // address a.txt and b.txt relatively, so materialize both files for the
    // raw channel to serve.
    await writeFile(join(scaffold.workspaceCwd, 'a.txt'), 'alpha\n')
    await writeFile(join(scaffold.workspaceCwd, 'b.txt'), 'beta\n')
    await seedSession(scaffold, seed, 'file-inspector-seed')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await appFrame(page).waitFor({ timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the panel on a read-row path link, streams the bytes, and remounts on a new file', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-file-inspector'))
    // The seeded Session browses on the chats tab; the fresh workspace
    // session owns the workspaces tab, so the seeded row is the only one.
    await page.getByRole('tab', { name: 'Chats' }).click()
    const seeded = page.getByRole('tree', { name: 'Chats' }).getByRole('treeitem').first()
    await expect.poll(() => seeded.count(), { timeout: 10_000 }).toBe(1)
    await seeded.click()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })

    // The read row's summary is a path link: clicking it selects the file and
    // opens the details column at the inspector's default width. The exact
    // name keeps the enclosing disclosure row (whose accessible name embeds
    // the path) out of the match.
    await page.getByRole('button', { name: 'a.txt', exact: true }).click()
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(480)
    // The code tab streams the real bytes through the raw channel. The read
    // card stays collapsed, so the content line appears only inside the panel.
    await page.getByText('alpha').first().waitFor({ timeout: 15_000 })

    // A second selection remounts the inspector on the next file.
    await page.getByRole('button', { name: 'b.txt', exact: true }).click()
    await page.getByText('b.txt', { exact: true }).first().waitFor({ timeout: 15_000 })
    await page.getByText('beta').first().waitFor({ timeout: 15_000 })

    // The panel closes from its own header.
    await page.getByRole('button', { name: 'Close details' }).click()
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
