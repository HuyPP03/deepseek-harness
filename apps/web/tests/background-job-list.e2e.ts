// Web e2e scenario: the session-header background-job list and the job log
// details seat over the real host. No model call is involved — a genuine
// `run_in_background` bash call registers with `ctx.jobs`, and the assertion
// chain is the whole delivery path: registry change feed → api-proxy
// `session/jobs` frame → the client's `jobsBySession` mirror → the header
// action, then a row click → the `jobs.log` unary → the details panel seat.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JobId } from '@deepseek-ai/dsh-jobs'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/fresh-round-trip/session.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/background-job-list', import.meta.url))
const RUNNING_EXPECTED = join(SNAPSHOT_DIR, 'running.expected.md')
const DETAILS_EXPECTED = join(SNAPSHOT_DIR, 'details.expected.md')
const SETTLED_EXPECTED = join(SNAPSHOT_DIR, 'settled.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'background-job-list-web-e2e'
// Prints 50 lines before holding, so the details-panel capture has log bytes
// to show; the sleep is long enough that the running assertions never race
// the process exiting on its own — the test kills it explicitly to reach the
// settled state.
const COMMAND = 'for i in $(seq 1 50); do echo "line $i"; done; sleep 45'
// The host's sandbox wrapper self-reports partial Landlock enforcement on
// kernels below the requested ABI, on the job's captured stderr. The report
// is kernel-dependent, so the details golden strips it from the retained log.
const LANDLOCK_REPORT = ' [stderr] landlock-run: partial enforcement (older Landlock ABI)'

/**
 * Wait for the Host to publish the live Agent that opening a session resumes.
 * @param scaffold - the booted web scaffold.
 * @param sessionId - the opened session's identity.
 * @returns the registered Agent instance.
 */
async function liveAgent(scaffold: WebScaffold, sessionId: SessionId): Promise<Agent> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const found = scaffold.ctx.agents.get(sessionId)
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`opening session "${sessionId}" published no live Agent`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe.skipIf(MODE === 'record')('web e2e: background job list', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let agent: Agent
  let jobId: JobId

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    // The seeded session is workspace-less, so it is a flat row on the chats
    // tab; the shell opens on the workspaces tab, so select chats explicitly.
    await page.getByRole('tab', { name: 'Chats' }).click()
    const sessionRow = page.getByRole('tree', { name: 'Chats' }).getByRole('treeitem').first()
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()

    // Opening the session drives the Host's ordinary Agent resolution; the
    // job owner must be that exact live instance, never a second one.
    // `expect.poll` is test-scoped, so this hook polls by hand.
    agent = await liveAgent(scaffold, SessionId(SEED_ID))
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows a running background job in the session header without a refresh', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-running'))
    // Point assertion, not a poll: `expect.poll` retries until a predicate
    // holds, so polling for zero passes at t=0 and proves nothing. The
    // "renders nothing without a task" branch is owned by the component suite.
    const trigger = page.getByRole('button', { name: '1 background job running' })
    expect(await trigger.count()).toBe(0)

    const started = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('background-job-list-e2e'),
      name: 'bash',
      arguments: { command: COMMAND, description: 'Hold a background slot open', run_in_background: true },
      agent,
    })
    const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
    const matched = /\bbash-\d+\b/.exec(reported)
    if (matched === null) throw new Error(`background bash reported no job id: ${reported}`)
    jobId = JobId(matched[0])

    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    const row = page.getByRole('list', { name: 'Background jobs' }).getByRole('listitem').first()
    await row.waitFor({ timeout: 10_000 })
    await expect.poll(() => row.textContent()).toContain(COMMAND)

    const snapshot = await captureStableAria(page, '[class*="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(RUNNING_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('opens the job log in the details panel when a row is clicked', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-details'))
    const row = page.getByRole('list', { name: 'Background jobs' }).getByRole('button').first()
    await row.click()
    // The popover closes with the gesture; the details panel takes over.
    expect(await page.getByRole('list', { name: 'Background jobs' }).count()).toBe(0)

    // The panel polls the retained log; wait for the last printed line so the
    // capture sees the complete 50-line output, not a mid-print slice.
    const panel = page.locator('[class*="detailsCol"]')
    await expect.poll(async () => (await panel.textContent()) ?? '', { timeout: 15_000 }).toContain('line 50')

    const snapshot = (await captureStableAria(page, '[class*="detailsCol"]', scaffold.workspaceCwd))
      .replace(LANDLOCK_REPORT, '')
    await compareOrRefreshGolden(DETAILS_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('flips the open list to the cancelled outcome when the registry settles it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-settled'))
    expect(scaffold.ctx.jobs.kill(jobId, agent, 'web e2e cancellation')).toBe('requested')

    // The trigger drops its live count once the task leaves running/stopping,
    // which is also the proof that settlement reached the browser unprompted.
    const idle = page.getByRole('button', { name: '1 background job' })
    await idle.waitFor({ timeout: 20_000 })
    // The row click closed the popover; reopen the list for the capture.
    await idle.click()

    const snapshot = await captureStableAria(page, '[class*="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['running.expected.md', 'details.expected.md', 'settled.expected.md'])
  })
})
