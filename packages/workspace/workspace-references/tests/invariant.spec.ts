/**
 * Tests for the reference-project invariant companion: a well-formed
 * `workspace/references` event passes while relative, empty, or
 * non-string paths and a reference naming the session's own workspace
 * fail, other session events and non-`session/event` dispatches are
 * ignored, and registration re-validates already-loaded sessions.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WorkspaceReferencesInvariant from '@deepseek-ai/dsh-workspace-references/invariant'

let root: string
let work: string
let refA: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-workspace-refs-inv-'))
  mkdirSync(join(root, 'work'))
  mkdirSync(join(root, 'ref-a'))
  work = join(root, 'work')
  refA = join(root, 'ref-a')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function referenceEvent(path: string | number): SessionEvent {
  return { type: 'workspace/references', seq: 0, time: 0, data: { references: [{ path }] } } as SessionEvent
}

async function setup(prepare?: (ctx: Context) => void): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  prepare?.(ctx)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(WorkspaceReferencesInvariant)
  return ctx
}

describe('workspace-references invariants', () => {
  it('accepts well-formed reference events and ignores other session data', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('inv-ok'), { meta: { cwd: work } })
    const event = referenceEvent(refA)
    expect(() => { ctx.emit('session/event', session, event) }).not.toThrow()
    // Non-reference session event.
    expect(() => { ctx.emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    } as SessionEvent) }).not.toThrow()
    // Non-session/event dispatch.
    expect(() => { ctx.emit('session/created', session) }).not.toThrow()
  })

  it('rejects a non-absolute path', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('inv-relative'), { meta: { cwd: work } })
    expect(() => { ctx.emit('session/event', session, referenceEvent('relative')) })
      .toThrow(/non-absolute path/)
  })

  it('rejects an empty or non-string path', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('inv-nonstring'), { meta: { cwd: work } })
    expect(() => { ctx.emit('session/event', session, referenceEvent('')) })
      .toThrow(/non-absolute path/)
    expect(() => { ctx.emit('session/event', session, referenceEvent(42)) })
      .toThrow(/non-absolute path/)
  })

  it('rejects a reference naming the session workspace, and not a bare path without one', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('inv-self'), { meta: { cwd: work } })
    expect(() => { ctx.emit('session/event', session, referenceEvent(work)) })
      .toThrow(/own workspace/)

    const bare = ctx.sessions.create(SessionId('inv-bare'))
    expect(() => { ctx.emit('session/event', bare, referenceEvent(work)) }).not.toThrow()
  })

  it('scans loaded sessions at registration', async () => {
    const ctx = await setup((pre) => {
      pre.sessions.create(SessionId('inv-scan'), { meta: { cwd: work } })
        .append('workspace/references', { references: [{ path: refA }] })
    })
    expect(ctx.sessions.list()).toHaveLength(1)
  })

  it('rejects a malformed event already present on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create(SessionId('inv-late'), { meta: { cwd: work } })
      .append('workspace/references', { references: [{ path: 'relative' }] })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(WorkspaceReferencesInvariant).then(() => undefined)).rejects.toThrow(/non-absolute path/)
  })
})
