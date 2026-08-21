// Keyless browser regression for the file inspector seat: a chat file link
// (the read row's summary) selects the file, opens the details column at the
// inspector's default width, and streams the real file bytes through the raw
// channel. The same links serve the preview seat: Markdown renders through
// the shared renderer, HTML loads through a sandboxed frame on the raw
// channel's own URL, and an image decodes its raw bytes directly — the
// captured raw requests prove the URLs the seat points its elements at.
//
// Each scenario owns a scaffold: a seeded Session's sidebar row is labeled by
// its workspace directory, so two seeds sharing one workspace are not
// distinguishable by row.
import { copyFile, readFile, writeFile } from 'node:fs/promises'
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

const CODE_FIXTURE = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const PREVIEW_FIXTURE = fileURLToPath(new URL('./snapshots/file-inspector-preview/seed.jsonl', import.meta.url))
const DOCX_FIXTURE = fileURLToPath(new URL('../../../packages/client/ui-file-inspector/tests/fixtures/hello.docx', import.meta.url))
const MODE = webSnapshotMode()

/** A 1x1 transparent PNG: the smallest image the browser will decode. */
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

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

/** Boot one scaffold with a single seeded Session and a live English page. */
async function bootSeeded(fixture: string, id: string, seedWorkspace: (cwd: string) => Promise<void>) {
  const scaffold = await launchWebScaffold({})
  const seed = await readFile(fixture, 'utf8')
  await seedWorkspace(scaffold.workspaceCwd)
  await seedSession(scaffold, seed, id)
  const browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
  await appFrame(page).waitFor({ timeout: 30_000 })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  return { scaffold, browser, page, tripwire }
}

/** The seeded Session is the only chats-tab row (the workspace session owns the workspaces tab). */
async function openSeeded(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Chats' }).click()
  const row = page.getByRole('tree', { name: 'Chats' }).getByRole('treeitem').first()
  await expect.poll(async () => await row.count(), { timeout: 10_000 }).toBe(1)
  await row.click()
}

describe.skipIf(MODE === 'record')('web e2e: file inspector code seat from chat file links', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    ;({ scaffold, browser, page, tripwire } = await bootSeeded(CODE_FIXTURE, 'file-inspector-seed', async (cwd) => {
      // The read rows address a.txt and b.txt relatively against the session
      // cwd (the scaffold workspace root): materialize both for the raw
      // channel to serve.
      await writeFile(join(cwd, 'a.txt'), 'alpha\n')
      await writeFile(join(cwd, 'b.txt'), 'beta\n')
    }))
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the panel on a read-row path link, streams the bytes, and remounts on a new file', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-file-inspector'))
    await openSeeded(page)
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

describe.skipIf(MODE === 'record')('web e2e: file inspector preview seat', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const rawRequests: string[] = []

  beforeAll(async () => {
    ;({ scaffold, browser, page, tripwire } = await bootSeeded(PREVIEW_FIXTURE, 'file-inspector-preview-seed', async (cwd) => {
      await writeFile(join(cwd, 'note.md'), '# Alpha\n\nbody\n')
      await writeFile(join(cwd, 'page.html'),
        '<html><head><title>Preview Page</title></head><body><p>Hello preview</p></body></html>\n')
      await writeFile(join(cwd, 'pix.png'), PNG_1x1)
      await copyFile(DOCX_FIXTURE, join(cwd, 'report.docx'))
      await writeFile(join(cwd, 'data.csv'), 'name,age\nAda,36\n')
    }))
    page.on('request', (request) => {
      if (request.url().includes('/api/file/')) rawRequests.push(request.url())
    })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('serves rendered markdown, a sandboxed HTML frame, and a raw image', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-file-inspector-preview'))
    await openSeeded(page)
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })

    // Markdown: the preview tab is the default seat and renders the read text
    // through the shared renderer; the source stays under the Code tab.
    await page.getByRole('button', { name: 'note.md', exact: true }).click()
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(480)
    await expect.poll(async () => await page.getByRole('tab', { name: 'Preview' }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => await page.getByRole('heading', { name: 'Alpha' }).count(), { timeout: 5_000 }).toBe(1)
    await page.getByRole('tab', { name: 'Code' }).click()
    await page.getByText('# Alpha').first().waitFor({ timeout: 15_000 })
    await page.getByRole('tab', { name: 'Preview' }).click()
    await expect.poll(async () => await page.getByRole('heading', { name: 'Alpha' }).count(), { timeout: 5_000 }).toBe(1)

    // HTML: the frame loads the raw channel's own URL, sandboxed empty (no
    // allow-list: a preview must not run the file's scripts).
    await page.getByRole('button', { name: 'page.html', exact: true }).click()
    const frame = page.locator('iframe').first()
    await frame.waitFor({ timeout: 15_000 })
    const pagePath = `${scaffold.workspaceCwd}/page.html`
    // The src attribute holds the same-origin relative URL the seat builds.
    expect(await frame.getAttribute('src')).toBe(
      `/api/file/file-inspector-preview-seed/${encodeURIComponent(pagePath)}`)
    expect(await frame.getAttribute('sandbox')).toBe('')
    // The empty sandbox gives the frame an opaque origin (the isolation is
    // the point), so the parent cannot read contentDocument; Playwright's
    // frame channel sees the loaded document through the browser.
    await frame.contentFrame().getByText('Hello preview').waitFor({ timeout: 15_000 })

    // Image: the browser decodes the raw bytes itself (a 1x1 PNG decodes to
    // one natural pixel), with no Code seat at all.
    await page.getByRole('button', { name: 'pix.png', exact: true }).click()
    const img = page.getByRole('img', { name: `${scaffold.workspaceCwd}/pix.png` })
    await img.waitFor({ timeout: 15_000 })
    expect(await img.getAttribute('src')).toBe(
      `/api/file/file-inspector-preview-seed/${encodeURIComponent(`${scaffold.workspaceCwd}/pix.png`)}`)
    await expect.poll(async () => await img.evaluate(el => el instanceof HTMLImageElement ? el.naturalWidth : 0),
      { timeout: 15_000 }).toBe(1)
    await expect(page.getByRole('tab', { name: 'Code' }).count()).resolves.toBe(0)

    // Docx: mammoth converts the bytes in the browser and lands the semantic
    // HTML in a sandboxed frame (srcDoc), with no second download.
    await page.getByRole('button', { name: 'report.docx', exact: true }).click()
    const docxFrame = page.locator('iframe').first()
    await docxFrame.waitFor({ timeout: 15_000 })
    expect(await docxFrame.getAttribute('sandbox')).toBe('')
    expect(await docxFrame.getAttribute('srcdoc')).toContain('Hello Docx Preview')

    // Xlsx/csv: SheetJS parses the first sheet into a table of cells.
    await page.getByRole('button', { name: 'data.csv', exact: true }).click()
    await expect.poll(async () => await page.getByRole('cell', { name: 'Ada' }).count(), { timeout: 15_000 }).toBe(1)
    await expect(page.getByRole('cell', { name: 'age' }).count()).resolves.toBe(1)

    // The panel closes from its own header, and every preview surface hit the
    // raw channel under the preview seed's session id.
    await page.getByRole('button', { name: 'Close details' }).click()
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    for (const name of ['note.md', 'page.html', 'pix.png', 'report.docx', 'data.csv']) {
      expect(rawRequests).toContain(
        `${scaffold.baseUrl}/api/file/file-inspector-preview-seed/${encodeURIComponent(`${scaffold.workspaceCwd}/${name}`)}`)
    }
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
