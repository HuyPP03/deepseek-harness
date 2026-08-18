/**
 * Tests for the `workspaceReferences` session-projection unit: mounting the
 * reference service beside the projection registry serves the folded
 * whole-value set plus the configured cap, the change feed pushes one frame
 * per whole-value transition (empty list detaches, unrelated events are
 * same-reference no-ops), and unmounting the service removes the key (HMR
 * safety). Assemblies without a projection registry keep the service
 * functional with no key.
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WorkspaceReferenceService from '@deepseek-ai/dsh-workspace-references'
import { referencesOf } from '@deepseek-ai/dsh-workspace-references'

let root: string
let work: string
let refA: string
let refB: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-workspace-refs-proj-'))
  for (const name of ['work', 'ref-a', 'ref-b']) mkdirSync(join(root, name))
  work = join(root, 'work')
  refA = join(root, 'ref-a')
  refB = join(root, 'ref-b')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Canonicalize for assertions: /tmp itself is a symlink on macOS. */
const real = (path: string): string => realpathSync.native(path)

async function harness(options: { config?: { maxReferences?: number }; withService?: boolean } = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (options.withService !== false) await ctx.plugin(WorkspaceReferenceService, options.config ?? {})
  return ctx
}

describe('workspaceReferences projection unit', () => {
  it('serves the empty set and the configured cap before any event', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('proj-init'))
    expect(ctx.sessionProjections.snapshot(session).values.workspaceReferences)
      .toEqual({ references: [], limit: 2 })

    const capped = await harness({ config: { maxReferences: 1 } })
    const cappedSession = capped.sessions.create(SessionId('proj-capped'))
    expect(capped.sessionProjections.snapshot(cappedSession).values.workspaceReferences)
      .toEqual({ references: [], limit: 1 })
  })

  it('pushes the folded set per transition and stays quiet for unrelated events', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('proj-fold'), { meta: { cwd: work } })
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_s, key, value, seq) => {
      changes.push({ key, value, seq })
    })

    await ctx.workspaceReferences.set(session, [refA, refB])
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ key: 'workspaceReferences', value: { references: [real(refA), real(refB)], limit: 2 } })
    expect(ctx.sessionProjections.snapshot(session).values.workspaceReferences)
      .toEqual({ references: [real(refA), real(refB)], limit: 2 })

    // Unrelated event: same-reference apply, no notification.
    session.append('turn/start', { turn: 1 })
    expect(changes).toHaveLength(1)

    // Whole-value replace.
    await ctx.workspaceReferences.set(session, [refB])
    expect(changes).toHaveLength(2)
    expect(changes[1]).toMatchObject({ key: 'workspaceReferences', value: { references: [real(refB)], limit: 2 } })

    // Empty list detaches all.
    await ctx.workspaceReferences.set(session, [])
    expect(changes).toHaveLength(3)
    expect(changes[2]).toMatchObject({ key: 'workspaceReferences', value: { references: [], limit: 2 } })
    expect(ctx.sessionProjections.snapshot(session).values.workspaceReferences)
      .toEqual({ references: [], limit: 2 })
  })

  it('detaching an already-empty set emits no transition', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('proj-empty'))
    const changes: string[] = []
    ctx.sessionProjections.onChanged((_s, key) => {
      changes.push(key)
    })
    await ctx.workspaceReferences.set(session, [])
    expect(changes).toEqual([])
  })

  it('keeps the empty fold for a redundant empty event', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('proj-idempotent'))
    const changes: string[] = []
    ctx.sessionProjections.onChanged((_s, key) => {
      changes.push(key)
    })
    // The service's no-op guard keeps an empty event out of an empty log, but
    // the fold must stay idempotent for a log that carries one.
    session.append('workspace/references', { references: [] })
    expect(changes).toEqual([])
    expect(ctx.sessionProjections.snapshot(session).values.workspaceReferences)
      .toEqual({ references: [], limit: 2 })
  })

  it('has no key without the service and drops it on unload (HMR safety)', async () => {
    const ctx = await harness({ withService: false })
    const session = ctx.sessions.create(SessionId('proj-hmr'))
    expect('workspaceReferences' in ctx.sessionProjections.snapshot(session).values).toBe(false)

    const fiber = await ctx.plugin(WorkspaceReferenceService, {})
    expect(ctx.sessionProjections.snapshot(session).values.workspaceReferences)
      .toEqual({ references: [], limit: 2 })
    await fiber.dispose()
    expect('workspaceReferences' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })

  it('keeps the service functional when no projection registry is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(WorkspaceReferenceService, {})
    expect(ctx.get('sessionProjections')).toBeUndefined()
    const session: Session = ctx.sessions.create(SessionId('proj-less'), { meta: { cwd: work } })
    await ctx.workspaceReferences.set(session, [refA])
    expect(referencesOf(session)).toEqual([real(refA)])
  })
})
