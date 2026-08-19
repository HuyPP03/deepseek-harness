/**
 * The files domain of the API gateway: files.list resolves the session's
 * working set (project cwd plus the attached reference projects) host-side
 * and walks it with the wire contract's bounds. Sessions are addressed, not
 * created; the client never submits a path.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { realpathSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { FILES_MAX_RESULTS } from '../src/files-walk.ts'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`files-${String(nextRpc++)}`), payload }
}

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-files-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return { api, ctx, cwd }
}

function attachReference(session: Session, dir: string): void {
  session.append('workspace/references', { references: [{ path: dir }] })
}

describe('files.list', () => {
  it('fails an unknown session with session-not-found', async () => {
    const { api } = await harness()
    const response = await api.files.list(request({ sessionId: SessionId('nope') }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('fails a cwd-less header with an internal error (legacy log)', async () => {
    const { api, ctx } = await harness()
    ctx.sessions.create(SessionId('legacy'), {})

    const response = await api.files.list(request({ sessionId: SessionId('legacy') }))

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'session "legacy" has no project cwd' },
    })
  })

  it('lists the session cwd files with the workspace root id', async () => {
    const { api, ctx, cwd } = await harness()
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'README.md'), '')
    writeFileSync(join(cwd, 'src/main.ts'), '')
    writeFileSync(join(cwd, '.env'), '')
    ctx.sessions.create(SessionId('s1'), { meta: { cwd } })

    const response = await api.files.list(request({ sessionId: SessionId('s1') }))

    expect(response.result).toMatchObject({ ok: true, value: { truncated: false } })
    if (response.result.ok) {
      // .env is skipped by the dot rule; the src directory is listed.
      expect(response.result.value.files.map(f => f.relative)).toEqual(['README.md', 'src', 'src/main.ts'])
      for (const file of response.result.value.files) {
        expect(file.root).toBe('workspace')
        expect(file.path).toBe(join(cwd, file.relative))
      }
      expect(response.result.value.files.find(f => f.relative === 'src')?.isDirectory).toBe(true)
    }
  })

  it('passes the query through to the host-side filter', async () => {
    const { api, ctx, cwd } = await harness()
    writeFileSync(join(cwd, 'README.md'), '')
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'src/main.ts'), '')
    ctx.sessions.create(SessionId('s5'), { meta: { cwd } })

    const response = await api.files.list(request({ sessionId: SessionId('s5'), query: 'MAIN' }))

    expect(response.result).toMatchObject({ ok: true })
    if (response.result.ok) {
      expect(response.result.value.files.map(f => f.relative)).toEqual(['src/main.ts'])
    }
  })

  it('lists the prefix directory itself for a trailing-slash query', async () => {
    const { api, ctx, cwd } = await harness()
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'src/main.ts'), '')
    writeFileSync(join(cwd, 'src/other.md'), '')
    ctx.sessions.create(SessionId('s6'), { meta: { cwd } })

    const response = await api.files.list(request({ sessionId: SessionId('s6'), query: 'src/' }))

    expect(response.result).toMatchObject({ ok: true })
    if (response.result.ok) {
      expect(response.result.value.files.map(f => f.relative)).toEqual(['src', 'src/main.ts', 'src/other.md'])
      expect(response.result.value.files[0]?.isDirectory).toBe(true)
    }
  })

  it('lists attached reference projects under their basename root id', async () => {
    const { api, ctx, cwd } = await harness()
    writeFileSync(join(cwd, 'README.md'), '')
    const reference = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-files-ref-')))
    writeFileSync(join(reference, 'lib.ts'), '')
    const session = ctx.sessions.create(SessionId('s2'), { meta: { cwd } })
    attachReference(session, reference)

    const response = await api.files.list(request({ sessionId: SessionId('s2') }))

    expect(response.result).toMatchObject({ ok: true })
    if (response.result.ok) {
      const files = response.result.value.files
      expect(files.filter(f => f.root === 'workspace').map(f => f.relative)).toEqual(['README.md'])
      const referenceFiles = files.filter(f => f.root === basename(reference))
      expect(referenceFiles.map(f => f.relative)).toEqual(['lib.ts'])
      expect(referenceFiles[0]?.path).toBe(join(reference, 'lib.ts'))
    }
  })

  it('skips a reference that vanished since attachment', async () => {
    const { api, ctx, cwd } = await harness()
    writeFileSync(join(cwd, 'README.md'), '')
    const session = ctx.sessions.create(SessionId('s3'), { meta: { cwd } })
    const gone = join(cwd, 'ref-gone')
    mkdirSync(gone, { recursive: true })
    writeFileSync(join(gone, 'x.txt'), '')
    attachReference(session, gone)
    rmSync(gone, { recursive: true, force: true })

    const response = await api.files.list(request({ sessionId: SessionId('s3') }))

    expect(response.result).toMatchObject({ ok: true })
    if (response.result.ok) {
      expect(response.result.value.files.map(f => f.relative)).toEqual(['README.md'])
      expect(response.result.value.truncated).toBe(false)
    }
  })

  it('caps the result rows at the result bound', async () => {
    const { api, ctx, cwd } = await harness()
    for (let i = 0; i < FILES_MAX_RESULTS + 5; i += 1) {
      writeFileSync(join(cwd, `f${String(i).padStart(5, '0')}.txt`), '')
    }
    ctx.sessions.create(SessionId('s4'), { meta: { cwd } })

    const response = await api.files.list(request({ sessionId: SessionId('s4') }))

    expect(response.result).toMatchObject({ ok: true })
    if (response.result.ok) {
      expect(response.result.value.files).toHaveLength(FILES_MAX_RESULTS)
      expect(response.result.value.truncated).toBe(false)
    }
  })

  it('serves a partial result when the request signal is aborted', async () => {
    const { api, ctx, cwd } = await harness()
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'README.md'), '')
    writeFileSync(join(cwd, 'src/main.ts'), '')
    ctx.sessions.create(SessionId('s7'), { meta: { cwd } })
    const aborted = new AbortController()
    aborted.abort()

    const response = await api.files.list(request({ sessionId: SessionId('s7') }), aborted.signal)

    // The walk stops at its first boundary check: an aborted request gets
    // the (empty) partial result, not an error.
    expect(response.result).toMatchObject({ ok: true, value: { files: [], truncated: false } })
  })
})
