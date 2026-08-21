/**
 * The files domain's raw byte channel (GET /api/file/<sessionId>/<path>):
 * the carrier's physical route answers the host-only surface directly —
 * verbatim bytes with a curated content type, nosniff, the 25 MiB bound on
 * the stat size, and the same working-set admission as the text read. The
 * file path rides as one percent-encoded segment and decodes once at the
 * boundary; an unencoded relative landing is refused as an escape.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createReadStream } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { FILE_RAW_MAX_BYTES } from '../src/files-raw.ts'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
  }
})

function sysError(code: string): NodeJS.ErrnoException {
  const error = new Error(`fake ${code}`) as NodeJS.ErrnoException
  error.code = code
  return error
}

function urlFor(path: string, query = ''): string {
  // The client's contract: the absolute path is one percent-encoded segment.
  return `http://localhost/api/file/${encodeURIComponent('r1')}/${encodeURIComponent(path)}${query}`
}

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-raw-')))
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-raw-out-')))
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
  const fetch = toFetchHandler(api).fetch
  return { api, ctx, cwd, outside, fetch }
}

describe('GET /api/file', () => {
  it('serves a contained file with its curated content type and nosniff', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'notes.md')
    writeFileSync(path, 'hello fixture\n')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('content-length')).toBe('14')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('hello fixture\n')
  })

  it('falls back to application/octet-stream for an unmapped extension', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'data.custom')
    writeFileSync(path, 'payload')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(await response.text()).toBe('payload')
  })

  it('serves an attachment disposition for ?download=1', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'sheet.xlsx')
    writeFileSync(path, 'sheet')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(path, '?download=1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="sheet.xlsx"')
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('serves an attached reference file', async () => {
    const { ctx, cwd, outside, fetch } = await harness()
    const path = join(outside, 'ref.txt')
    writeFileSync(path, 'ref\n')
    const session = ctx.sessions.create(SessionId('r1'), { meta: { cwd } })
    session.append('workspace/references', { references: [{ path: outside }] })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ref\n')
  })

  it('refuses an outside path with 403', async () => {
    const { ctx, cwd, outside, fetch } = await harness()
    const path = join(outside, 'secret.txt')
    writeFileSync(path, 'hidden\n')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(403)
  })

  it('refuses an unencoded relative landing as an escape', async () => {
    const { ctx, cwd, fetch } = await harness()
    writeFileSync(join(cwd, 'local.txt'), 'local\n')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    // A raw relative segment decodes to a relative path, which resolves
    // against the host process cwd and must be refused, not served.
    const response = await fetch(`http://localhost/api/file/r1/${encodeURIComponent(join(cwd, 'local.txt')).slice(1)}`)

    expect(response.status).toBe(403)
  })

  it('answers 404 for an unknown session', async () => {
    const { cwd, fetch } = await harness()
    const path = join(cwd, 'x.txt')
    writeFileSync(path, 'x\n')

    const response = await fetch(`http://localhost/api/file/${encodeURIComponent('nope')}/${encodeURIComponent(path)}`)

    expect(response.status).toBe(404)
  })

  it('answers 500 for a cwd-less session', async () => {
    const { ctx, fetch } = await harness()
    ctx.sessions.create(SessionId('r1'), {})

    const response = await fetch(urlFor('/anywhere/x.txt'))

    expect(response.status).toBe(500)
  })

  it('answers 404 for a vanished file', async () => {
    const { ctx, cwd, fetch } = await harness()
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(join(cwd, 'gone.txt')))

    expect(response.status).toBe(404)
  })

  it('answers 400 for a directory', async () => {
    const { ctx, cwd, fetch } = await harness()
    mkdirSync(join(cwd, 'dir'))
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(join(cwd, 'dir')))

    expect(response.status).toBe(400)
  })

  it('answers 413 for a file over the 25 MiB bound', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'big.bin')
    writeFileSync(path, Buffer.alloc(FILE_RAW_MAX_BYTES + 1, 0))
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(413)
  })

  it('serves a file exactly at the 25 MiB bound', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'edge.bin')
    writeFileSync(path, Buffer.alloc(FILE_RAW_MAX_BYTES, 0))
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(FILE_RAW_MAX_BYTES))
    await response.body?.cancel()
  })

  it('answers HEAD with headers and no body', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'notes.md')
    writeFileSync(path, 'hello fixture\n')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

    const response = await fetch(urlFor(path), { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('14')
    expect(response.body).toBeNull()
  })

  it('answers 404 for a malformed path shape', async () => {
    const { cwd, fetch } = await harness()
    const path = join(cwd, 'x.txt')
    writeFileSync(path, 'x\n')

    expect((await fetch('http://localhost/api/file/r1')).status).toBe(404)
    expect((await fetch('http://localhost/api/file/')).status).toBe(404)
    expect((await fetch('http://localhost/api/file/r1/')).status).toBe(404)
  })

  it('answers 400 for an empty sessionId segment', async () => {
    const { cwd, fetch } = await harness()
    const path = join(cwd, 'x.txt')
    writeFileSync(path, 'x\n')

    // A double slash leaves an empty sessionId segment for the schema.
    expect((await fetch(`http://localhost/api/file//${encodeURIComponent(path)}`)).status).toBe(400)
  })

  it('answers 400 for an undecodable path segment', async () => {
    const { fetch } = await harness()

    // A lone % is not a valid percent-encoding.
    expect((await fetch('http://localhost/api/file/r1/%zz')).status).toBe(400)
  })

  it('answers 400 for an undecodable sessionId segment', async () => {
    const { cwd, fetch } = await harness()
    const path = join(cwd, 'x.txt')
    writeFileSync(path, 'x\n')

    // A lone % is not a valid percent-encoding in the sessionId segment.
    expect((await fetch(`http://localhost/api/file/%zz/${encodeURIComponent(path)}`)).status).toBe(400)
  })

  it('answers 404 when the stream open races the file away', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'race.txt')
    writeFileSync(path, 'x\n')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      throw sysError('ENOENT')
    })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(404)
  })

  it('answers 500 when the stream open is denied', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'denied.txt')
    writeFileSync(path, 'x\n')
    ctx.sessions.create(SessionId('r1'), { meta: { cwd } })
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      throw sysError('EACCES')
    })

    const response = await fetch(urlFor(path))

    expect(response.status).toBe(500)
  })

  it.skipIf(process.platform === 'win32')('answers 500 for a permission-denied file', async () => {
    const { ctx, cwd, fetch } = await harness()
    const path = join(cwd, 'locked.txt')
    writeFileSync(path, 'secret\n')
    chmodSync(path, 0o000)
    try {
      ctx.sessions.create(SessionId('r1'), { meta: { cwd } })

      const response = await fetch(urlFor(path))

      expect(response.status).toBe(500)
    } finally {
      chmodSync(path, 0o600)
    }
  })
})
