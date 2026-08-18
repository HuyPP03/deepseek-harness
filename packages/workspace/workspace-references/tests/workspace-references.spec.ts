/**
 * Tests for the session reference-projects package: the
 * `normalizeReferencePaths` admission (absolute, existing directory,
 * no self-reference, dedupe, cap), the `referencesOf` whole-value fold,
 * `WorkspaceReferenceService.set()` append semantics, and the
 * `workspace:references` prompt context (pinned intro plus one line per
 * reference, empty without references).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WorkspaceReferenceService, {
  REFERENCE_PROJECTS_INTRO,
  normalizeReferencePaths,
  referencesOf,
} from '@deepseek-ai/dsh-workspace-references'
import type { Config } from '@deepseek-ai/dsh-workspace-references'

let root: string
let work: string
let refA: string
let refB: string
let refC: string
let refFile: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-workspace-references-'))
  const mkdir = (name: string): string => {
    const path = join(root, name)
    mkdirSync(path)
    return path
  }
  work = mkdir('work')
  refA = mkdir('ref-a')
  refB = mkdir('ref-b')
  refC = mkdir('ref-c')
  refFile = join(refA, 'file.txt')
  writeFileSync(refFile, 'not a directory')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Canonicalize for assertions: /tmp itself is a symlink on macOS. */
const real = (path: string): string => realpathSync.native(path)

async function mounted(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(WorkspaceReferenceService, config)
  return ctx
}

function agentFor(session: Session): Agent {
  return { session } as unknown as Agent
}

function referenceEvents(session: Session) {
  return session.events.filter(event => event.type === 'workspace/references')
}

describe('normalizeReferencePaths', () => {
  it('canonicalizes to first-seen order and admits an empty set', async () => {
    expect(await normalizeReferencePaths([refB, refA], work, 2)).toEqual([real(refB), real(refA)])
    expect(await normalizeReferencePaths([], work, 2)).toEqual([])
  })

  it('rejects a non-string or empty entry', async () => {
    await expect(normalizeReferencePaths([''], work, 2)).rejects.toThrow(/non-empty path/)
    await expect(normalizeReferencePaths([42 as never], work, 2)).rejects.toThrow(/non-empty path/)
  })

  it('rejects a relative entry', async () => {
    await expect(normalizeReferencePaths(['relative/dir'], work, 2)).rejects.toThrow(/must be absolute paths/)
  })

  it('rejects a missing entry', async () => {
    await expect(normalizeReferencePaths([join(root, 'missing')], work, 2)).rejects.toThrow(/does not exist/)
  })

  it('rejects a file entry', async () => {
    await expect(normalizeReferencePaths([refFile], work, 2)).rejects.toThrow(/not a directory/)
  })

  it('rejects the session cwd, including through its canonical form', async () => {
    await expect(normalizeReferencePaths([work], work, 2)).rejects.toThrow(/cannot reference itself/)
    // A different spelling of the same physical directory is still the workspace.
    await expect(normalizeReferencePaths([real(work)], work, 2)).rejects.toThrow(/cannot reference itself/)
  })

  it('admits a session without a cwd', async () => {
    expect(await normalizeReferencePaths([refA], undefined, 2)).toEqual([real(refA)])
  })

  it('resolves a missing cwd lexically and keeps comparing against it', async () => {
    const missingCwd = join(root, 'missing-cwd')
    expect(await normalizeReferencePaths([refA], missingCwd, 2)).toEqual([real(refA)])
    // The lexical form still names a different place than any real reference.
    await expect(normalizeReferencePaths([join(root, 'missing-cwd', 'sub')], missingCwd, 2)).rejects.toThrow(/does not exist/)
  })

  it('deduplicates to first-seen order', async () => {
    expect(await normalizeReferencePaths([refA, refA, refB], work, 2)).toEqual([real(refA), real(refB)])
  })

  it('rejects a set over the cap', async () => {
    await expect(normalizeReferencePaths([refA, refB, refC], work, 2)).rejects.toThrow(/at most 2 reference project/)
  })

  it('enforces a configured cap', async () => {
    await expect(normalizeReferencePaths([refA, refB], work, 1)).rejects.toThrow(/at most 1 reference project/)
  })
})

describe('referencesOf', () => {
  it('folds to the last whole-value event and stays empty without one', () => {
    const session = Session.create(SessionId('refs-fold'))
    expect(referencesOf(session)).toEqual([])
    session.append('turn/start', { turn: 1 })
    expect(referencesOf(session)).toEqual([])
    session.append('workspace/references', { references: [{ path: refA }] })
    expect(referencesOf(session)).toEqual([refA])
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(referencesOf(session)).toEqual([refA])
    session.append('workspace/references', { references: [{ path: refB }] })
    expect(referencesOf(session)).toEqual([refB])
    session.append('workspace/references', { references: [] })
    expect(referencesOf(session)).toEqual([])
  })
})

describe('WorkspaceReferenceService', () => {
  it('defaults the cap to two and carries a configured one', async () => {
    const ctx = await mounted()
    expect(ctx.workspaceReferences.maxReferences).toBe(2)
    const custom = await mounted({ maxReferences: 1 })
    expect(custom.workspaceReferences.maxReferences).toBe(1)
  })

  it('rejects a cap below one at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await expect(ctx.plugin(WorkspaceReferenceService, { maxReferences: 0 })).rejects.toThrow(/maxReferences/)
  })

  it('appends one whole-value event on change and none when unchanged', async () => {
    const ctx = await mounted()
    const session = ctx.sessions.create(SessionId('set-basic'), { meta: { cwd: work } })
    await ctx.workspaceReferences.set(session, [refA, refB])
    const events = referenceEvents(session)
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toEqual({ references: [{ path: real(refA) }, { path: real(refB) }] })

    // Same set: no new event.
    await ctx.workspaceReferences.set(session, [refA, refB])
    expect(referenceEvents(session)).toHaveLength(1)

    // Same length, different order: a new whole-value event.
    await ctx.workspaceReferences.set(session, [refB, refA])
    const all = referenceEvents(session)
    expect(all).toHaveLength(2)
    expect(referencesOf(session)).toEqual([real(refB), real(refA)])
  })

  it('detaches all with an empty set', async () => {
    const ctx = await mounted()
    const session = ctx.sessions.create(SessionId('set-detach'), { meta: { cwd: work } })
    await ctx.workspaceReferences.set(session, [refA])
    await ctx.workspaceReferences.set(session, [])
    const events = referenceEvents(session)
    expect(events).toHaveLength(2)
    expect(events[1]?.data).toEqual({ references: [] })
    expect(referencesOf(session)).toEqual([])
    // Detaching an empty set is a no-op.
    await ctx.workspaceReferences.set(session, [])
    expect(referenceEvents(session)).toHaveLength(2)
  })

  it('rejects a failing set without touching the log', async () => {
    const ctx = await mounted()
    const session = ctx.sessions.create(SessionId('set-invalid'), { meta: { cwd: work } })
    await expect(ctx.workspaceReferences.set(session, ['relative'])).rejects.toThrow(/must be absolute paths/)
    expect(referenceEvents(session)).toHaveLength(0)
    await expect(ctx.workspaceReferences.set(session, [work])).rejects.toThrow(/cannot reference itself/)
    expect(referenceEvents(session)).toHaveLength(0)
  })

  it('serves a session without a cwd', async () => {
    const ctx = await mounted()
    const plain = ctx.sessions.create(SessionId('set-plain'))
    await ctx.workspaceReferences.set(plain, [refA])
    expect(referencesOf(plain)).toEqual([real(refA)])
  })

  it('renders the pinned intro and one line per reference', async () => {
    const ctx = await mounted()
    const session = ctx.sessions.create(SessionId('prompt-refs'), { meta: { cwd: work } })
    const contextOf = (agent?: Agent): Promise<string | undefined> =>
      ctx.systemPrompt.assemble(agent === undefined ? {} : { agent })
        .then(assembly => assembly.contexts.find(context => context.name === 'workspace:references')?.text)

    expect(await contextOf()).toBe('')
    expect(await contextOf(agentFor(session))).toBe('')

    await ctx.workspaceReferences.set(session, [refA, refB])
    expect(await contextOf(agentFor(session))).toBe(
      [REFERENCE_PROJECTS_INTRO, `- ${real(refA)}`, `- ${real(refB)}`].join('\n'),
    )

    await ctx.workspaceReferences.set(session, [])
    expect(await contextOf(agentFor(session))).toBe('')
  })
})
