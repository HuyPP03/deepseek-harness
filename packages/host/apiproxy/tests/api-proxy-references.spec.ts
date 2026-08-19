/**
 * Tests for the session reference-projects surface of the API gateway:
 * `session.create` admits `referenceWorkspaceIds` (validated before the
 * session commits; unknown ids, self-references, and unmounted capability
 * leave no session behind) and `session.setReferences` swaps the whole
 * set mid-session, including detaching with an empty list, over the fetch
 * carrier's route and wire schema.
 */
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkspaceReferenceService from '@deepseek-ai/dsh-workspace-references'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { createApiProxy, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest, RpcResponse, ServerResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import {
  sessionCreateRequestSchema,
  sessionSetReferencesRequestSchema,
} from '@deepseek-ai/dsh-host-apiproxy/api/sessions.schema'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`refs-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function referenceEvents(session: Session) {
  return session.events.filter(event => event.type === 'workspace/references')
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Compose the API over real Session, Agent, Storage, Domain, Workspace, and reference services. */
async function harness(
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-refs-'))),
  options: { withReferences?: boolean } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  if (options.withReferences !== false) await ctx.plugin(WorkspaceReferenceService, {})

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, createOptions) {
      const session = ctx.sessions.create(
        createOptions.sessionId,
        createOptions.meta === undefined ? {} : { meta: createOptions.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
  })
  return { api, ctx, root }
}

/** Stage one directory under the harness root and register it as a workspace. */
async function stageWorkspace(api: ReturnType<typeof createApiProxy>, root: string, name: string) {
  const path = join(root, name)
  mkdirSync(path)
  return expectOk(await api.workspace.create(request({ path }))).workspace
}

describe('session.create with referenceWorkspaceIds', () => {
  it('records one whole-value event for the admitted set', async () => {
    const { api, ctx, root } = await harness()
    const main = await stageWorkspace(api, root, 'w-main')
    const refA = await stageWorkspace(api, root, 'w-ref-a')
    const refB = await stageWorkspace(api, root, 'w-ref-b')
    const sessionId = SessionId('refs-created')

    const created = expectOk(await api.sessions.create(request({
      workspaceId: main.workspaceId,
      sessionId,
      referenceWorkspaceIds: [refA.workspaceId, refB.workspaceId],
    })))
    expect(created.sessionId).toBe(sessionId)

    const session = ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('created session missing from store')
    const events = referenceEvents(session)
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toEqual({ references: [{ path: refA.path }, { path: refB.path }] })
    expect(ctx.sessionProjections.snapshot(session).values.workspaceReferences)
      .toEqual({ references: [refA.path, refB.path], limit: 2 })
  })

  it('fails with workspace-not-found and creates no session for an unknown reference', async () => {
    const { api, ctx, root } = await harness()
    const main = await stageWorkspace(api, root, 'w-main')
    const sessionId = SessionId('refs-unknown')

    const created = await api.sessions.create(request({
      workspaceId: main.workspaceId,
      sessionId,
      referenceWorkspaceIds: ['ghost' as WorkspaceId],
    }))
    expect(created.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-not-found', details: { workspaceId: 'ghost' } },
    })
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })

  it('refuses to reference the session own workspace', async () => {
    const { api, ctx, root } = await harness()
    const main = await stageWorkspace(api, root, 'w-main')
    const sessionId = SessionId('refs-self')

    const created = await api.sessions.create(request({
      workspaceId: main.workspaceId,
      sessionId,
      referenceWorkspaceIds: [main.workspaceId],
    }))
    expect(created.result).toMatchObject({
      ok: false,
      error: { code: 'references-invalid', details: { reason: 'invalid-reference-set' } },
    })
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })

  it('answers references-unsupported when the capability is unmounted', async () => {
    const { api, ctx, root } = await harness(undefined, { withReferences: false })
    const main = await stageWorkspace(api, root, 'w-main')
    const refA = await stageWorkspace(api, root, 'w-ref-a')
    const sessionId = SessionId('refs-nomount')

    const created = await api.sessions.create(request({
      workspaceId: main.workspaceId,
      sessionId,
      referenceWorkspaceIds: [refA.workspaceId],
    }))
    expect(created.result).toMatchObject({
      ok: false,
      error: { code: 'references-unsupported' },
    })
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })

  it('refuses references for a session without a workspace', async () => {
    const { api, ctx, root } = await harness()
    const refA = await stageWorkspace(api, root, 'w-ref-a')
    const sessionId = SessionId('refs-noworkspace')

    const created = await api.sessions.create(request({
      sessionId,
      referenceWorkspaceIds: [refA.workspaceId],
    }))
    expect(created.result).toMatchObject({
      ok: false,
      error: { code: 'references-require-workspace', details: { sessionId } },
    })
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })

  it('treats an empty reference list as no references', async () => {
    const { api, ctx, root } = await harness()
    const main = await stageWorkspace(api, root, 'w-main')
    const sessionId = SessionId('refs-empty')

    const created = expectOk(await api.sessions.create(request({
      workspaceId: main.workspaceId,
      sessionId,
      referenceWorkspaceIds: [],
    })))
    const session = ctx.sessions.get(created.sessionId)
    if (session === undefined) throw new Error('created session missing from store')
    expect(referenceEvents(session)).toHaveLength(0)
  })

  it('rejects an over-cap list at the wire schema', () => {
    const parsed = sessionCreateRequestSchema.safeParse({
      workspaceId: 'w' as WorkspaceId,
      referenceWorkspaceIds: ['a' as WorkspaceId, 'b' as WorkspaceId, 'c' as WorkspaceId],
    })
    expect(parsed.success).toBe(false)
    const empty = sessionCreateRequestSchema.safeParse({ referenceWorkspaceIds: [] })
    expect(empty.success).toBe(true)
  })
})

describe('session.setReferences', () => {
  it('replaces the whole set, including detaching with an empty list', async () => {
    const { api, ctx, root } = await harness()
    const main = await stageWorkspace(api, root, 'w-main')
    const refA = await stageWorkspace(api, root, 'w-ref-a')
    const refB = await stageWorkspace(api, root, 'w-ref-b')
    const created = expectOk(await api.sessions.create(request({ workspaceId: main.workspaceId })))
    const session = ctx.sessions.get(created.sessionId)
    if (session === undefined) throw new Error('created session missing from store')

    expectOk(await api.sessions.setReferences(request({
      sessionId: created.sessionId,
      referenceWorkspaceIds: [refA.workspaceId, refB.workspaceId],
    })))
    expect(referenceEvents(session)).toHaveLength(1)
    expect(ctx.sessionProjections.snapshot(session).values.workspaceReferences)
      .toEqual({ references: [refA.path, refB.path], limit: 2 })

    // Whole-value replace.
    expectOk(await api.sessions.setReferences(request({
      sessionId: created.sessionId,
      referenceWorkspaceIds: [refB.workspaceId],
    })))
    expect(referenceEvents(session)).toHaveLength(2)

    // Empty list detaches all.
    expectOk(await api.sessions.setReferences(request({
      sessionId: created.sessionId,
      referenceWorkspaceIds: [],
    })))
    const events = referenceEvents(session)
    expect(events).toHaveLength(3)
    expect(events[2]?.data).toEqual({ references: [] })
  })

  it('maps an unknown reference id to workspace-not-found without touching the log', async () => {
    const { api, ctx, root } = await harness()
    const main = await stageWorkspace(api, root, 'w-main')
    const created = expectOk(await api.sessions.create(request({ workspaceId: main.workspaceId })))
    const session = ctx.sessions.get(created.sessionId)
    if (session === undefined) throw new Error('created session missing from store')

    const response = await api.sessions.setReferences(request({
      sessionId: created.sessionId,
      referenceWorkspaceIds: ['ghost' as WorkspaceId],
    }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-not-found', details: { workspaceId: 'ghost' } },
    })
    expect(referenceEvents(session)).toHaveLength(0)
  })

  it('refuses to reference the session own workspace', async () => {
    const { api, ctx, root } = await harness()
    const main = await stageWorkspace(api, root, 'w-main')
    const created = expectOk(await api.sessions.create(request({ workspaceId: main.workspaceId })))
    const session = ctx.sessions.get(created.sessionId)
    if (session === undefined) throw new Error('created session missing from store')

    const response = await api.sessions.setReferences(request({
      sessionId: created.sessionId,
      referenceWorkspaceIds: [main.workspaceId],
    }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'references-invalid', details: { reason: 'invalid-reference-set' } },
    })
    expect(referenceEvents(session)).toHaveLength(0)
  })

  it('refuses a non-empty set for a session without a workspace', async () => {
    const { api, ctx, root } = await harness()
    const refA = await stageWorkspace(api, root, 'w-ref-a')
    const created = expectOk(await api.sessions.create(request({})))
    const session = ctx.sessions.get(created.sessionId)
    if (session === undefined) throw new Error('created session missing from store')

    const response = await api.sessions.setReferences(request({
      sessionId: created.sessionId,
      referenceWorkspaceIds: [refA.workspaceId],
    }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'references-require-workspace', details: { sessionId: created.sessionId } },
    })
    expect(referenceEvents(session)).toHaveLength(0)
  })

  it('treats the empty set as a no-op for a session without a workspace', async () => {
    const { api, ctx } = await harness()
    const created = expectOk(await api.sessions.create(request({})))
    const session = ctx.sessions.get(created.sessionId)
    if (session === undefined) throw new Error('created session missing from store')

    expectOk(await api.sessions.setReferences(request({
      sessionId: created.sessionId,
      referenceWorkspaceIds: [],
    })))
    expect(referenceEvents(session)).toHaveLength(0)
  })

  it('answers session-not-found for an unknown session', async () => {
    const { api } = await harness()
    const response = await api.sessions.setReferences(request({
      sessionId: SessionId('refs-ghost-session'),
      referenceWorkspaceIds: [],
    }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
  })

  it('keeps the subagent ownership fence on child sessions', async () => {
    const { api, ctx, root } = await harness()
    const session = ctx.sessions.create(SessionId('refs-child'), {
      meta: { cwd: root, parentSession: SessionId('refs-parent'), origin: 'subagent' },
    })
    ctx.agents.register(stubAgent(session))

    const response = await api.sessions.setReferences(request({
      sessionId: session.id,
      referenceWorkspaceIds: [],
    }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'agent-busy' },
    })
  })

  describe('over the fetch carrier', () => {
    function dispatch(api: ReturnType<typeof createApiProxy>, payload: unknown) {
      const handler = toFetchHandler(api)
      return handler.fetch(
        new URL('/api/session.setReferences', 'http://dsh.internal'),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: RpcId('refs-carrier'), method: 'session.setReferences', payload }),
          signal: new AbortController().signal,
        },
      ).then(async (response) => {
        expect(response.status).toBe(200)
        return await response.json() as ServerResponse
      })
    }

    it('dispatches the route and answers the accepted frame', async () => {
      const { api, ctx, root } = await harness()
      const main = await stageWorkspace(api, root, 'w-main')
      const created = expectOk(await api.sessions.create(request({ workspaceId: main.workspaceId })))

      const body = await dispatch(api, { sessionId: created.sessionId, referenceWorkspaceIds: [] })
      expect(body).toMatchObject({
        type: 'server-response',
        rpcId: RpcId('refs-carrier'),
        result: { ok: true, value: { accepted: true } },
      })
      const session = ctx.sessions.get(created.sessionId)
      if (session === undefined) throw new Error('created session missing from store')
      expect(referenceEvents(session)).toHaveLength(0)
    })

    it('rejects an over-cap list as bad-request before the implementation', async () => {
      const { api, root } = await harness()
      const main = await stageWorkspace(api, root, 'w-main')
      const created = expectOk(await api.sessions.create(request({ workspaceId: main.workspaceId })))

      const body = await dispatch(api, {
        sessionId: created.sessionId,
        referenceWorkspaceIds: ['a' as WorkspaceId, 'b' as WorkspaceId, 'c' as WorkspaceId],
      })
      expect(body).toMatchObject({
        type: 'server-response',
        result: { ok: false, error: { code: 'bad-request' } },
      })
    })
  })
})

describe('session.setReferences wire schema', () => {
  it('requires the whole list and caps it at the gateway maximum', () => {
    expect(sessionSetReferencesRequestSchema.safeParse({
      sessionId: 's' as never,
      referenceWorkspaceIds: [],
    }).success).toBe(true)
    expect(sessionSetReferencesRequestSchema.safeParse({
      sessionId: 's' as never,
      referenceWorkspaceIds: ['a' as WorkspaceId, 'b' as WorkspaceId, 'c' as WorkspaceId],
    }).success).toBe(false)
    expect(sessionSetReferencesRequestSchema.safeParse({ sessionId: 's' as never }).success).toBe(false)
  })
})
