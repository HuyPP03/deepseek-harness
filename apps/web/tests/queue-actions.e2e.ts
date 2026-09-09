// Keyless browser coverage for pending queue actions through the shipped Web
// composition and real HTTP/SSE wire. Replay overrides park consecutive turns
// so the page can edit and remove exact occurrences, then stop the active turn
// while proving the preserved Queue advances in FIFO order.
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/queue-actions', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./snapshots/live-interactions/session.jsonl', import.meta.url))
const COLLAPSED_EXPECTED = join(SNAPSHOT_DIR, 'collapsed.expected.md')
const EDITING_EXPECTED = join(SNAPSHOT_DIR, 'editing.expected.md')
const LAYOUT_EXPECTED = join(SNAPSHOT_DIR, 'layout.expected.md')
const PRESERVED_EXPECTED = join(SNAPSHOT_DIR, 'preserved.expected.md')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

const ACTIVE_PROMPT = 'Reply with a one-sentence description of event sourcing, then stop.'
const REMOVE = 'Queue item to remove'
const EDIT = 'Queue item to edit'
const EDITED = 'Edited queue item'
const TAIL = 'Queue item preserved after stop'
const WAKE = 'Wake the preserved queue'

/** Durable turn-end classifications observed by the scenario. */
function turnEndReasons(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : [])
}

/**
 * A viewport resize animates the column layout (sidebar collapse plus the
 * dock cards re-centering), so the boxes keep moving for a couple of hundred
 * milliseconds after setViewportSize resolves. Sample until every selector
 * reports the same box on two consecutive reads before asserting.
 * @param page - the loaded scenario page.
 * @param selectors - boxes to settle, in assertion order.
 * @returns the settled [x, y, width, height] tuple per selector, in order.
 */
async function settleBoxes<S extends readonly [string, ...string[]]>(
  page: Page,
  selectors: S,
): Promise<{ readonly [K in keyof S]: readonly [number, number, number, number] }> {
  const sample = async () => Promise.all(selectors.map(async (selector) => {
    const box = await page.locator(selector).boundingBox()
    if (box === null) throw new Error(`element ${selector} vanished while settling`)
    return [box.x, box.y, box.width, box.height] as const
  }))
  let previous = await sample()
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const next = await sample()
    const settled = next.every((values, index) => {
      const before = previous[index]
      return before !== undefined && values.every((value, i) => before[i] === value)
    })
    if (settled) {
      return next as { readonly [K in keyof S]: readonly [number, number, number, number] }
    }
    previous = next
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  throw new Error('dock panel geometry never settled after the viewport resize')
}

describe('web e2e: queue row actions', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let overrideDir: string | undefined

  afterEach(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (overrideDir !== undefined) {
      await rm(overrideDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    overrideDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'queue-actions teardown failed')
  })

  it.skipIf(MODE === 'record')('edits and removes exact occurrences and preserves Queue across stop', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-web-queue-actions-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    const recorded = deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))
    expect(recorded).toHaveLength(1)
    const replay: ReplayEntry[] = [
      { kind: 'hang', readyFile },
      recorded[0]!,
      recorded[0]!,
      recorded[0]!,
    ]
    await writeFile(overridePath, JSON.stringify(replay))

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-queue-actions'))

    const input = page.locator('textarea').first()
    const firstSettled = scaffold.whenTurnSettled()
    await input.fill(ACTIVE_PROMPT)
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)

    for (const text of [REMOVE, EDIT]) {
      await input.fill(text)
      await input.press('Enter')
    }
    const queueHeader = page.getByRole('button', { name: '2 queued messages' })
    await expect.poll(() => queueHeader.getAttribute('aria-expanded'), { timeout: 10_000 })
      .toBe('false')
    const collapsedSnapshot = await captureStableAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(COLLAPSED_EXPECTED, collapsedSnapshot, MODE)
    await queueHeader.click()
    await expect.poll(
      () => page.getByRole('button', { name: 'Remove queued message' }).count(),
      { timeout: 10_000 },
    ).toBe(2)

    await page.setViewportSize({ width: 640, height: 1000 })
    const [[queueX, , queueWidth], [composerX, , composerWidth]] =
      await settleBoxes(page, ['[data-queue-dock]', '[data-composer-card]'])
    expect(queueX).toBeGreaterThanOrEqual(composerX)
    expect(queueX + queueWidth).toBeLessThanOrEqual(composerX + composerWidth)
    const queueLeftInset = queueX - composerX
    const queueRightInset = composerX + composerWidth - queueX - queueWidth
    const composerMetrics = await page.locator('[data-composer-card]').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        dockInset: Number.parseFloat(style.getPropertyValue('--dsh-composer-dock-inset')),
      }
    })
    expect(queueLeftInset).toBeCloseTo(composerMetrics.dockInset, 1)
    expect(queueRightInset).toBeCloseTo(composerMetrics.dockInset, 1)
    await page.setViewportSize({ width: 1680, height: 1000 })

    const editRow = page.getByText(EDIT, { exact: true }).locator('..')
    await editRow.getByRole('button', { name: 'Edit queued message' }).click()
    const editor = page.getByRole('textbox', { name: 'Edit queued message' })
    await editor.fill(EDITED)
    const editingSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EDITING_EXPECTED, editingSnapshot, MODE)
    await page.getByRole('button', { name: 'Save queued message' }).click()
    await page.getByText(EDITED, { exact: true }).waitFor()

    const removeRow = page.getByText(REMOVE, { exact: true }).locator('..')
    await removeRow.getByRole('button', { name: 'Remove queued message' }).click()
    await expect.poll(() => page.getByText(REMOVE, { exact: true }).count()).toBe(0)

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(sessionEvents.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])

    await input.fill(TAIL)
    await input.press('Enter')
    await expect.poll(
      () => page.getByRole('button', { name: 'Remove queued message' }).count(),
      { timeout: 10_000 },
    ).toBe(2)

    await page.getByRole('button', { name: 'Stop generating' }).click()
    await firstSettled
    await expect.poll(() => page.getByRole('button', { name: 'Stop generating' }).count())
      .toBe(0)
    await expect.poll(() => page.getByRole('button', { name: 'Remove queued message' }).count())
      .toBe(2)

    const preservedSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PRESERVED_EXPECTED, preservedSnapshot, MODE)

    const settled = scaffold.whenTurnSettled()
    await input.fill(WAKE)
    await input.press('Enter')
    await settled
    await expect.poll(() => turnEndReasons(sessionEvents), { timeout: 15_000 })
      .toEqual(['aborted', 'completed', 'completed', 'completed'])
    expect(sessionEvents.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])).toEqual([ACTIVE_PROMPT, EDITED, TAIL, WAKE])
    await expect.poll(() => page.locator('[data-queue-dock]').count()).toBe(0)
  }, 120_000)

  it.skipIf(MODE === 'record')('orders Todo before Goal and Queue on one responsive card column', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-web-context-layout-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    await writeFile(overridePath, JSON.stringify([{ kind: 'hang', readyFile } satisfies ReplayEntry]))

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-context-layout'))

    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill('/goal Keep the composer context panels aligned')
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)
    await page.locator('[data-goal-bar]').waitFor({ timeout: 10_000 })

    const sessions = scaffold.ctx.sessions.list()
    expect(sessions).toHaveLength(1)
    sessions[0]!.append('todo/write', {
      todos: [
        { content: 'Confirm the panel order', status: 'completed' },
        { content: 'Align the panel widths', status: 'in_progress' },
      ],
    })
    await page.locator('[data-testid="todo-panel"]').waitFor({ timeout: 10_000 })

    for (const text of ['Layout queue first', 'Layout queue second']) {
      await input.fill(text)
      await input.press('Enter')
    }
    const queueHeader = page.getByRole('button', { name: '2 queued messages' })
    await expect.poll(() => queueHeader.getAttribute('aria-expanded'), { timeout: 10_000 })
      .toBe('false')

    const layoutSnapshot = await captureStableAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(LAYOUT_EXPECTED, layoutSnapshot, MODE)

    const PANEL_SELECTORS = ['[data-queue-dock] > div', '[data-testid="todo-panel"]', '[data-goal-bar] > div'] as const

    const expectAlignedContextPanels = async () => {
      const [queuePanelBox, todoBox, goalBox] = await settleBoxes(page, PANEL_SELECTORS)
      expect(todoBox[1]).toBeLessThan(goalBox[1])
      expect(goalBox[1]).toBeLessThan(queuePanelBox[1])
      expect(todoBox[0]).toBeCloseTo(goalBox[0], 1)
      expect(todoBox[0]).toBeCloseTo(queuePanelBox[0], 1)
      expect(todoBox[2]).toBeCloseTo(goalBox[2], 1)
      expect(todoBox[2]).toBeCloseTo(queuePanelBox[2], 1)
    }
    await expectAlignedContextPanels()
    await page.setViewportSize({ width: 640, height: 1000 })
    await expectAlignedContextPanels()
    await page.setViewportSize({ width: 1680, height: 1000 })

    await queueHeader.click()
    const removeButtons = page.getByRole('button', { name: 'Remove queued message' })
    await expect.poll(() => removeButtons.count(), { timeout: 10_000 }).toBe(2)
    await removeButtons.first().click()
    await expect.poll(() => removeButtons.count(), { timeout: 10_000 }).toBe(1)
    await removeButtons.first().click()
    await expect.poll(() => page.locator('[data-queue-dock]').count(), { timeout: 10_000 }).toBe(0)
    await page.getByRole('button', { name: 'Clear goal' }).click()
    await expect.poll(() => page.locator('[data-goal-bar]').count(), { timeout: 10_000 }).toBe(0)
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled

    expect(turnEndReasons(sessionEvents)).toEqual(['aborted'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      ['collapsed.expected.md', 'editing.expected.md', 'layout.expected.md', 'preserved.expected.md', 'ui.expected.md'],
    )
  })
})
