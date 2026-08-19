/**
 * ui-file-mention browser half: the '@' file source against the real
 * InputTriggerService (registration + HMR-safety disposal), then the source
 * behavior contract driven directly on the captured source — sessionId
 * addressing, the session-keyed fetch cache (single-flight, TTL re-fetch,
 * failure retry, connection/reset clear), case-insensitive ranked filtering
 * with the menu cap, the pick's per-root insertion forms (workspace-
 * relative vs reference-absolute, the plain-text-reference decision), and
 * the settled-cache degradation of a pick after a cache clear.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ClientSessionContext, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../src/client/index.ts'
import type { FileEntry } from '@deepseek-ai/dsh-api-remotes/client'

type ListResult =
  | { ok: true; value: { files: FileEntry[]; truncated: boolean } }
  | { ok: false; error: { code: string; message: string; details: object } }
type ListFn = (payload: object, signal?: AbortSignal) => Promise<{ result: ListResult }>

async function bench(list: ListFn, addressed?: SessionId) {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  ctx.provide('inputTriggers', { registerSource: (src: InputTriggerSource) => { captured = src; return () => {} } })
  ctx.provide('connection', { api: { files: { list } } })
  ctx.provide('sessions', {
    subagentAddress: (id: SessionId) => id === addressed
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
  })
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, source: captured! }
}

const ROWS: FileEntry[] = [
  { path: '/w/README.md', relative: 'README.md', root: 'workspace' },
  { path: '/w/src/main.ts', relative: 'src/main.ts', root: 'workspace' },
  { path: '/w/src/utils.ts', relative: 'src/utils.ts', root: 'workspace' },
  { path: '/w/deep/nest/thing.txt', relative: 'deep/nest/thing.txt', root: 'workspace' },
  { path: '/r/lib.ts', relative: 'lib.ts', root: 'myref' },
  { path: '/r/src/inner.ts', relative: 'src/inner.ts', root: 'myref' },
]

const listOk = (rows: readonly FileEntry[] = ROWS): ListFn => () =>
  Promise.resolve({ result: { ok: true as const, value: { files: [...rows], truncated: false } } })

function countingList(rows: readonly FileEntry[] = ROWS) {
  const payloads: object[] = []
  const list: ListFn = (payload) => {
    payloads.push(payload)
    return listOk(rows)(payload)
  }
  return { list, payloads }
}

const sid = (id: string) => id as SessionId
const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })
const req = (query: string, signal?: AbortSignal) =>
  ({ query, position: 'leading' as const, signal: signal ?? new AbortController().signal })
const pick = (name: string, id = 's1') => ({
  candidate: { name },
  session: proj(id),
  position: 'leading' as const,
  via: 'menu' as const,
  span: { start: 0, end: name.length + 1, draftRev: 1 },
})

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['inputTriggers', 'connection', 'sessions'])
  })

  it('registers the "@" file source; disposal frees the name (HMR safety)', async () => {
    const ctx = new Context()
    // InputTriggerService itself injects 'sessions'; the stub unblocks its fiber.
    ctx.provide('sessions', { subagentAddress: () => undefined })
    await ctx.plugin(InputTriggerService).await()
    ctx.provide('connection', { api: { files: { list: listOk() } } })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerService
    const rival = {
      trigger: '@' as const,
      name: 'files',
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
    }
    // Live registration holds the (trigger, name) seat…
    expect(() => inputTriggers.registerSource(rival)).toThrow(/already registered/)
    // …and fiber teardown releases it.
    await fiber.dispose()
    expect(() => inputTriggers.registerSource(rival)).not.toThrow()
  })
})

describe('candidates: sessionId addressing and ranking', () => {
  it('lists via {sessionId} and keeps the host order on an empty query', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    const items = await source.candidates(proj('s1'), req(''))
    expect(payloads).toEqual([{ sessionId: 's1' }])
    expect(items).toEqual([
      { name: 'README.md' },
      { name: 'src/main.ts' },
      { name: 'src/utils.ts' },
      { name: 'deep/nest/thing.txt' },
      { name: 'myref/lib.ts' },
      { name: 'myref/src/inner.ts' },
    ])
  })

  it('filters case-insensitively and ranks basename-prefix over path-prefix over substring', async () => {
    const { source } = await bench(listOk())
    // 'main' is a basename prefix of src/main.ts only.
    expect(await source.candidates(proj('s1'), req('MAIN'))).toEqual([{ name: 'src/main.ts' }])
    // 'src' is a path prefix of three rows; ties go to the shorter, then
    // alphabetical, relative path.
    expect(await source.candidates(proj('s1'), req('src'))).toEqual([
      { name: 'src/main.ts' },
      { name: 'myref/src/inner.ts' },
      { name: 'src/utils.ts' },
    ])
    // A substring match ranks below every prefix.
    expect(await source.candidates(proj('s1'), req('nest'))).toEqual([{ name: 'deep/nest/thing.txt' }])
    expect(await source.candidates(proj('s1'), req('zzz'))).toEqual([])
  })

  it('caps the menu at the usability bound', async () => {
    const big = Array.from({ length: 60 }, (_, i) => ({
      path: `/w/f${String(i).padStart(2, '0')}.txt`,
      relative: `f${String(i).padStart(2, '0')}.txt`,
      root: 'workspace' as const,
    }))
    const { source } = await bench(listOk(big))
    expect(await source.candidates(proj('s1'), req(''))).toHaveLength(50)
  })

  it('rejects on a failed result', async () => {
    const { source } = await bench(() => Promise.resolve({
      result: { ok: false, error: { code: 'internal', message: 'boom', details: {} } },
    }))
    await expect(source.candidates(proj('s1'), req(''))).rejects.toThrow('files.list failed: internal: boom')
  })

  it('does not fetch for an addressed subagent session', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list, sid('child'))
    await expect(source.candidates(proj('child'), req(''))).resolves.toEqual([])
    source.warm!(proj('child'))
    expect(payloads).toEqual([])
  })
})

describe('fetch cache', () => {
  it('re-polls across keystrokes locally: one RPC per session', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s1'), req('src'))
    expect(payloads).toHaveLength(1)
    await source.candidates(proj('s2'), req(''))
    expect(payloads).toHaveLength(2)
  })

  it('single-flight: concurrent candidates on one cold key share one RPC', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    const [a, b] = await Promise.all([
      source.candidates(proj('s1'), req('main')),
      source.candidates(proj('s1'), req('src')),
    ])
    expect(payloads).toHaveLength(1)
    expect(a).toEqual([{ name: 'src/main.ts' }])
    expect(b).toHaveLength(3)
  })

  it('an aborted caller yields empty but leaves the shared fetch warm', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    const aborted = new AbortController()
    aborted.abort()
    await expect(source.candidates(proj('s1'), req('src', aborted.signal))).resolves.toEqual([])
    await expect(source.candidates(proj('s1'), req('src'))).resolves.toHaveLength(3)
    expect(payloads).toHaveLength(1)
  })

  it('a failed fetch does not poison the key: the next caller retries', async () => {
    let fail = true
    const payloads: object[] = []
    const { source } = await bench((payload) => {
      payloads.push(payload)
      return fail
        ? Promise.resolve({ result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } } })
        : listOk()(payload)
    })
    await expect(source.candidates(proj('s1'), req(''))).rejects.toThrow('boom')
    fail = false
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(6)
    expect(payloads).toHaveLength(2)
  })

  it('serves a settled key from cache, then re-fetches after the TTL', async () => {
    vi.useFakeTimers()
    try {
      const { list, payloads } = countingList()
      const { source } = await bench(list)
      await source.candidates(proj('s1'), req(''))
      await source.candidates(proj('s1'), req(''))
      expect(payloads).toHaveLength(1)
      // Inside the TTL the settled rows still serve.
      vi.setSystemTime(Date.now() + 10_000)
      await source.candidates(proj('s1'), req(''))
      expect(payloads).toHaveLength(1)
      // Past the TTL the same session pays a fresh RPC.
      vi.setSystemTime(Date.now() + 16_000)
      await source.candidates(proj('s1'), req(''))
      expect(payloads).toHaveLength(2)
      expect(payloads[1]).toEqual({ sessionId: 's1' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stale entry whose fetch fails after replacement keeps the newer entry', async () => {
    vi.useFakeTimers()
    try {
      let rejectStale!: (value: unknown) => void
      let call = 0
      const list: ListFn = (payload) => {
        call += 1
        if (call === 1) {
          return new Promise((_resolve, reject) => { rejectStale = reject })
        }
        return listOk()(payload)
      }
      const { source } = await bench(list)
      const stale = source.candidates(proj('s1'), req(''))
        .then(() => { throw new Error('the stale fetch fails by design') }, () => {})
      vi.setSystemTime(Date.now() + 16_000)
      await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(6)
      rejectStale({ result: { ok: false, error: { code: 'internal', message: 'boom', details: {} } } })
      await stale
      // The replacement entry is intact: the stale failure dropped nothing.
      await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(6)
      expect(call).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the scope-birth warm prewarms the session key fire-and-forget', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    source.warm!(proj('s1'))
    await vi.waitFor(() => { expect(payloads).toHaveLength(1) })
    expect(payloads[0]).toEqual({ sessionId: 's1' })
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(6)
    expect(payloads).toHaveLength(1)
    await source.candidates(proj('s2'), req(''))
    expect(payloads).toHaveLength(2)
  })

  it('a failing scope-birth warm swallows the error and leaves the key retryable', async () => {
    let fail = true
    const { source } = await bench(payload => fail
      ? Promise.resolve({ result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } } })
      : listOk()(payload))
    source.warm!(proj('s1'))
    // The fire-and-forget warm settles into the swallow path; the failed key
    // is dropped so the next consumer retries (vi.waitFor retries while the
    // in-flight warm is still failing).
    await vi.waitFor(async () => {
      fail = false
      await source.candidates(proj('s1'), req(''))
    })
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(6)
  })

  it('connection/reset clears every cached session', async () => {
    const { list, payloads } = countingList()
    const { ctx, source } = await bench(list)
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s2'), req(''))
    expect(payloads).toHaveLength(2)
    ctx.emit('connection/reset')
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s2'), req(''))
    expect(payloads).toHaveLength(4)
  })
})

describe('onPick: per-root insertion forms', () => {
  it('inserts the workspace-relative path for a main-project file', async () => {
    const { source } = await bench(listOk())
    await source.candidates(proj('s1'), req(''))
    expect(source.onPick(pick('src/main.ts'))).toEqual({ text: '@src/main.ts ' })
  })

  it('inserts the absolute path for a reference file', async () => {
    const { source } = await bench(listOk())
    await source.candidates(proj('s1'), req(''))
    expect(source.onPick(pick('myref/lib.ts'))).toEqual({ text: '@/r/lib.ts ' })
  })

  it('disambiguates the same relative path across roots by the display prefix', async () => {
    const { source } = await bench(listOk())
    await source.candidates(proj('s1'), req(''))
    // 'src/main.ts' is the workspace file; 'myref/src/inner.ts' the reference's.
    expect(source.onPick(pick('src/main.ts'))).toEqual({ text: '@src/main.ts ' })
    expect(source.onPick(pick('myref/src/inner.ts'))).toEqual({ text: '@/r/src/inner.ts ' })
  })

  it('degrades to the display form when the settled cache is cleared', async () => {
    const { list } = countingList()
    const { ctx, source } = await bench(list)
    await source.candidates(proj('s1'), req(''))
    ctx.emit('connection/reset')
    // A menu rendered from the stale listing still picks: the text mention
    // is the display form — inert but honest.
    expect(source.onPick(pick('src/main.ts'))).toEqual({ text: '@src/main.ts ' })
  })
})
