// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

// The recorded single-turn fixture the plain-chat prompt replays (a keyless
// assembled turn: one model call, no tools).
const BASE_FIXTURE = fileURLToPath(new URL('./snapshots/live-interactions/session.jsonl', import.meta.url))

const REF_DONE = 'MULTI_WS_REF_DONE'

function textStream(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('web e2e: multi-workspace session', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let replayDir: string | undefined
  let mainPath: string
  let referencePaths: string[] = []
  let referenceSessionId: SessionId

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-multi-workspace-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    // The first model call (the reference session's prompt) replays the
    // primary override; the plain-chat turn replays the recorded child.
    await writeFile(replayOverride, JSON.stringify([{ kind: 'chunks', chunks: textStream(REF_DONE) }]))
    const baseFixture = await readFile(BASE_FIXTURE, 'utf8')
    const [header, ...eventLines] = baseFixture.trimEnd().split('\n')
    if (header === undefined) throw new Error('multi-workspace e2e: base fixture has no header')
    const childPath = join(replayDir, 'reference-turn.jsonl')
    await writeFile(childPath, [
      header.replace('"id":"{{sessionId}}"', '"id":"recorded-reference-turn"'),
      ...eventLines,
      '',
    ].join('\n'))
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      replayChildFixtures: [childPath],
      replayContextWindow: 10_000_000,
      paceMs: 10,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The projects are created AFTER the page settles: with no workspace at
    // boot, the initial selection clears to the no-session hero, and the
    // client's workspace feed picks the creations up live (a workspace
    // present at boot would auto-connect its blank session instead).
    const root = scaffold.workspaceCwd
    const workspaces = [] as { title: string; path: string }[]
    for (const title of ['alpha', 'beta', 'gamma', 'delta']) {
      const path = join(root, 'projects', title)
      await mkdir(path, { recursive: true })
      const created = await scaffold.ctx.workspaceRegistry.create(path)
      workspaces.push({ title: created.title, path: created.path })
    }
    const [main, first, second] = workspaces
    if (main === undefined || first === undefined || second === undefined) {
      throw new Error('multi-workspace e2e: workspace setup incomplete')
    }
    mainPath = main.path
    referencePaths = [first.path, second.path]
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'multi-workspace e2e cleanup failed')
  })

  it('hero multi-select starts one session with a main project and two references', async () => {
    // Cold hero: the workspace chip opens the multi-select menu. The rows
    // appear as the client's feed picks up the host-side creations.
    await page.getByRole('button', { name: 'Choose workspace' }).click()
    await expect.poll(() => page.getByRole('menuitem', { name: /^delta/ }).count(), { timeout: 15_000 }).toBe(1)
    await page.getByRole('menuitem', { name: /^alpha/ }).click()
    await page.getByRole('menuitem', { name: /^beta/ }).click()
    await page.getByRole('menuitem', { name: /^gamma/ }).click()
    // The fourth row is disabled once the set holds a main plus two refs.
    expect(await page.getByRole('menuitem', { name: /^delta/ }).isDisabled()).toBe(true)
    // The first selection badges as Main; the set is still editable.
    expect(await page.getByRole('menuitem', { name: /^alpha/ }).textContent()).toContain('Main')
    await page.getByRole('menuitem', { name: 'Start' }).click()
    // The blank reference session lands in the hero with a live composer.
    await page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
      .waitFor({ timeout: 15_000 })
    // Host-side: the new session is the main project's only account, and its
    // log holds the whole-value references event (admission order).
    await expect.poll(() => scaffold.ctx.workspaceRegistry.list()
      .find(workspace => workspace.path === mainPath)?.sessionIds).toHaveLength(1)
    const sessionId = scaffold.ctx.workspaceRegistry.list()
      .find(workspace => workspace.path === mainPath)?.sessionIds[0]
    if (sessionId === undefined) throw new Error('multi-workspace e2e: main project session missing')
    referenceSessionId = sessionId
    const agent = scaffold.ctx.agents.get(sessionId)
    expect(agent).toBeDefined()
    const events = agent?.session.events ?? []
    const referenceEvents = events.filter(event => event.type === 'workspace/references')
    expect(referenceEvents.at(-1)?.data.references.map(reference => reference.path))
      .toEqual([...referencePaths])
    // Model-visible: the workspace:references context renders the fold for
    // the agent's own scope (assembled the way the loop assembles it).
    const assembly = await scaffold.ctx.systemPrompt.assemble(assembleContextFor(agent!))
    const referenceContext = assembly.contexts.find(context => context.name === 'workspace:references')
    expect(referenceContext?.text).toContain(referencePaths[0])
    expect(referenceContext?.text).toContain(referencePaths[1])
  }, 120_000)

  it('sends a prompt in the reference session and raises its reference chip', async () => {
    // The reference session is still current (blank hero composer). Arm the
    // settle barrier before the send: the turn can end before the rendered
    // text is visible, so a late subscription would miss turn/end.
    const settled = scaffold.whenTurnSettled()
    const composer = page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
    await composer.fill('MULTI_WS_REF_PROMPT start')
    await composer.press('Enter')
    await settled
    await expect.poll(() => page.getByText(REF_DONE).isVisible(), { timeout: 15_000 }).toBe(true)
    // The first message raises the session header and with it the
    // reference-project chip, showing the attached count.
    const chip = page.getByRole('button', { name: 'Reference projects' })
    await expect.poll(() => chip.isVisible(), { timeout: 15_000 }).toBe(true)
    expect(await chip.textContent()).toContain('2 reference projects')
  }, 120_000)

  it('No project starts a plain-chat session whose composer sends', async () => {
    // The sidebar's top-level New Session button (workspaces tab) starts a
    // blank session for the current Workspace (alpha); from its hero, No
    // project + Start mints a session with no workspace.
    await page.getByRole('tab', { name: 'Workspaces' }).click()
    await page.getByRole('button', { name: 'New session' }).last().click()
    await page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
      .waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Choose workspace' }).click()
    await page.getByRole('menuitem', { name: 'No project (plain chat)' }).click()
    await page.getByRole('menuitem', { name: 'Start' }).click()
    const composer = page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
    await composer.waitFor({ timeout: 15_000 })
    const settled = scaffold.whenTurnSettled()
    await composer.fill('MULTI_WS_PLAIN_PROMPT start')
    await composer.press('Enter')
    await settled
    // The plain session's cwd is the app project directory, so it is
    // accounted under no workspace: the reference session stays the only
    // reference, and its project's accounts hold no foreign session.
    const plainSession = scaffold.ctx.sessions.list()
      .find(session => session.header.cwd === scaffold.workspaceCwd)
    if (plainSession === undefined) throw new Error('multi-workspace e2e: plain session missing')
    const accounted = scaffold.ctx.workspaceRegistry.list()
      .flatMap(workspace => workspace.sessionIds)
    expect(accounted).toContain(referenceSessionId)
    expect(accounted).not.toContain(plainSession.id)
  }, 120_000)

  it('chip toggles whole-value sets through the host', async () => {
    // Back to the reference session: its row browses on the workspaces tab;
    // expand its project group only when the row is not already listed — the
    // earlier legs may have left the group open, and a blind group click
    // would collapse it.
    await page.getByRole('tab', { name: 'Workspaces' }).click()
    const sessionRow = page.getByRole('treeitem', { name: /^MULTI_WS_REF_PROMPT/ })
    if ((await sessionRow.count()) === 0) {
      await page.getByRole('treeitem', { name: /^alpha/ }).click()
    }
    await sessionRow.click()
    const chip = page.getByRole('button', { name: 'Reference projects' })
    await expect.poll(() => chip.isVisible(), { timeout: 15_000 }).toBe(true)
    const agent = scaffold.ctx.agents.get(referenceSessionId)
    const lastReferences = (): string[] | undefined =>
      (agent?.session.events ?? [])
        .filter(event => event.type === 'workspace/references')
        .at(-1)?.data.references.map(reference => reference.path)
    // Detach the second reference: the wire set is the whole remainder.
    await chip.click()
    await page.getByRole('menuitem', { name: /gamma/ }).click()
    await expect.poll(() => lastReferences()).toEqual([referencePaths[0]])
    expect(await chip.textContent()).toContain('1 reference project')
    // Re-attach it: the set grows back to the original pair.
    await chip.click()
    await page.getByRole('menuitem', { name: /gamma/ }).click()
    await expect.poll(() => lastReferences()).toEqual([...referencePaths])
    expect(await chip.textContent()).toContain('2 reference projects')
  }, 120_000)
})
