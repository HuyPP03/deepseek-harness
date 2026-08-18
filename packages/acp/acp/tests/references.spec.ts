/**
 * Tests for ACP newSession additionalDirectories: a mounted
 * workspace-reference service records one to two directories as exactly one
 * whole-value event after the session commits, a bad set fails before any
 * session is created (capability unmounted, over the cap, missing, relative,
 * or the session's own workspace), and a failed append rolls the created
 * session back with both Error and non-Error rejections.
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import WorkspaceReferenceService, { normalizeReferencePaths } from '@deepseek-ai/dsh-workspace-references'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

vi.mock('@deepseek-ai/dsh-workspace-references', async (importOriginal) => {
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-workspace-references')>()
  return { ...original, normalizeReferencePaths: vi.fn(original.normalizeReferencePaths) }
})

/** Canonicalize for assertions: /tmp itself is a symlink on macOS. */
const real = (path: string): string => realpathSync.native(path)

function referenceEvents(session: Session) {
  return session.events.filter(event => event.type === 'workspace/references')
}

let root: string
let work: string
let refA: string
let refB: string
let refC: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-acp-refs-'))
  for (const name of ['work', 'ref-a', 'ref-b', 'ref-c']) mkdirSync(join(root, name))
  work = join(root, 'work')
  refA = join(root, 'ref-a')
  refB = join(root, 'ref-b')
  refC = join(root, 'ref-c')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

async function mountedHarness(): Promise<BridgeHarness> {
  const harness = await makeBridgeHarness()
  await harness.ctx.plugin(WorkspaceReferenceService, {})
  await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  return harness
}

describe('newSession additionalDirectories', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('records the admitted set as exactly one whole-value event', async () => {
    harness = await mountedHarness()
    const { sessionId } = await harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [refA, refB],
    })
    const session = harness.ctx.agents.get(SessionId(sessionId))?.session
    expect(session).toBeDefined()
    if (session === undefined) throw new Error('created agent missing')
    const events = referenceEvents(session)
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toEqual({ references: [{ path: real(refA) }, { path: real(refB) }] })
  })

  it('records a single directory', async () => {
    harness = await mountedHarness()
    const { sessionId } = await harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [refA],
    })
    const session = harness.ctx.agents.get(SessionId(sessionId))?.session
    if (session === undefined) throw new Error('created agent missing')
    const events = referenceEvents(session)
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toEqual({ references: [{ path: real(refA) }] })
  })

  it('rejects a set over the cap before the session commits', async () => {
    harness = await mountedHarness()
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [refA, refB, refC],
    })).rejects.toThrow(/at most 2 reference project/)
    expect(harness.ctx.sessions.list()).toHaveLength(0)
  })

  it('rejects a missing reference before the session commits', async () => {
    harness = await mountedHarness()
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [join(work, 'missing')],
    })).rejects.toThrow(/reference does not exist/)
    expect(harness.ctx.sessions.list()).toHaveLength(0)
  })

  it('rejects a relative entry with the parameter message', async () => {
    harness = await mountedHarness()
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: ['relative'],
    })).rejects.toThrow(/additionalDirectories entries must be absolute paths: relative/)
    expect(harness.ctx.sessions.list()).toHaveLength(0)
  })

  it('rejects a reference naming the session workspace', async () => {
    harness = await mountedHarness()
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [work],
    })).rejects.toThrow(/cannot reference itself/)
    expect(harness.ctx.sessions.list()).toHaveLength(0)
  })

  it('answers invalidParams when the capability is unmounted', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [refA],
    })).rejects.toThrow(/additionalDirectories requires a deployment that mounts @deepseek-ai\/dsh-workspace-references/)
    expect(harness.ctx.sessions.list()).toHaveLength(0)
  })

  it('rolls back the session when the append fails', async () => {
    harness = await mountedHarness()
    const references = harness.ctx.get('workspaceReferences')
    if (references === undefined) throw new Error('reference service not mounted')
    const set = vi.spyOn(references, 'set').mockRejectedValueOnce(new Error('append failed'))
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [refA],
    })).rejects.toThrow(/references were not recorded: append failed/)
    expect(harness.ctx.sessions.list()).toHaveLength(0)
    set.mockRestore()
  })

  it('folds a non-Error append rejection through String()', async () => {
    harness = await mountedHarness()
    const references = harness.ctx.get('workspaceReferences')
    if (references === undefined) throw new Error('reference service not mounted')
    const set = vi.spyOn(references, 'set').mockRejectedValueOnce('raw-append')
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [refA],
    })).rejects.toThrow(/references were not recorded: raw-append/)
    expect(harness.ctx.sessions.list()).toHaveLength(0)
    set.mockRestore()
  })

  it('folds a non-Error pre-validation rejection through String()', async () => {
    vi.mocked(normalizeReferencePaths).mockImplementationOnce(async () => {
      throw 'raw-string-failure'
    })
    harness = await mountedHarness()
    await expect(harness.client.newSession({
      cwd: work, mcpServers: [], additionalDirectories: [refA],
    })).rejects.toThrow('raw-string-failure')
    expect(harness.ctx.sessions.list()).toHaveLength(0)
  })
})
