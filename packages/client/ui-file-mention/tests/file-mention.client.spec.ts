/**
 * ui-file-mention browser half: the '@' file source against the real
 * InputTriggerService (registration + HMR-safety disposal), then the source
 * behavior contract driven directly on the captured source — sessionId
 * addressing, the host-side query pass-through, the (session, query)-keyed
 * fetch cache (single-flight, browse 15s vs live 2s TTL, live-query
 * supersession, failure retry, connection/reset clear), the menu cap, the
 * pick's per-root insertion forms (workspace-relative vs reference-absolute,
 * trailing slash for directories, the plain-text-reference decision), and
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

/**
 * Emulates the host's query semantics (case-insensitive, separator-normalized:
 * basename prefix beats path prefix beats substring; a directory matches
 * through its trailing-slash form; ties go to the shorter, then byte-wise
 * alphabetical, relative path) over a static working set.
 */
function hostFilter(rows: readonly FileEntry[], query: string | undefined): FileEntry[] {
  const q = (query ?? '').trim().toLowerCase().replace(/\\/gu, '/')
  if (q === '') return [...rows]
  const scored: { row: FileEntry; score: number; key: string }[] = []
  for (const row of rows) {
    const normalized = row.relative.toLowerCase().replace(/\\/gu, '/')
    const base = normalized.slice(normalized.lastIndexOf('/') + 1)
    const relSlash = row.isDirectory ? normalized + '/' : normalized
    let score: number | undefined
    if (base.startsWith(q)) score = 0
    else if (relSlash.startsWith(q)) score = 1
    else if (relSlash.includes(q)) score = 2
    if (score === undefined) continue
    scored.push({ row, score, key: normalized })
  }
  scored.sort((a, b) => a.score - b.score
    || a.key.length - b.key.length
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return scored.map(x => x.row)
}

interface BenchOpts {
  addressed?: SessionId
  /** Summaries stamped into the list snapshot (session id → its agent preset). */
  byId?: Record<string, { agentPreset?: string }>
  /** The connectors' published preset set (the provider-chat authority). */
  connectorPresetIds?: ReadonlySet<string>
}

async function bench(list: ListFn, opts: BenchOpts = {}) {
  const { addressed, byId = {}, connectorPresetIds } = opts
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  ctx.provide('inputTriggers', { registerSource: (src: InputTriggerSource) => { captured = src; return () => {} } })
  ctx.provide('connection', { api: { files: { list } } })
  ctx.provide('sessions', {
    subagentAddress: (id: SessionId) => id === addressed
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
    list: { getSnapshot: () => ({ byId }), subscribe: () => () => undefined },
  })
  if (connectorPresetIds !== undefined) {
    ctx.provide('connectorPresetIds', { getSnapshot: () => connectorPresetIds })
  }
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, source: captured! }
}

const ROWS: FileEntry[] = [
  { path: '/w/README.md', relative: 'README.md', root: 'workspace', isDirectory: false },
  { path: '/w/src', relative: 'src', root: 'workspace', isDirectory: true },
  { path: '/w/src/main.ts', relative: 'src/main.ts', root: 'workspace', isDirectory: false },
  { path: '/w/src/utils.ts', relative: 'src/utils.ts', root: 'workspace', isDirectory: false },
  { path: '/w/deep/nest/thing.txt', relative: 'deep/nest/thing.txt', root: 'workspace', isDirectory: false },
  { path: '/r/lib.ts', relative: 'lib.ts', root: 'myref', isDirectory: false },
  { path: '/r/src', relative: 'src', root: 'myref', isDirectory: true },
  { path: '/r/src/inner.ts', relative: 'src/inner.ts', root: 'myref', isDirectory: false },
]

const listOk = (rows: readonly FileEntry[] = ROWS): ListFn => (payload) => {
  const { query } = payload as { query?: string }
  return Promise.resolve({ result: { ok: true as const, value: { files: hostFilter(rows, query), truncated: false } } })
}

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

describe('candidates: sessionId addressing and the host query pass-through', () => {
  it('lists via {sessionId} on an empty query and keeps the host order', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    const items = await source.candidates(proj('s1'), req(''))
    expect(payloads).toEqual([{ sessionId: 's1' }])
    expect(items).toEqual([
      { name: 'README.md' },
      { name: 'src/' },
      { name: 'src/main.ts' },
      { name: 'src/utils.ts' },
      { name: 'deep/nest/thing.txt' },
      { name: 'myref/lib.ts' },
      { name: 'myref/src/' },
      { name: 'myref/src/inner.ts' },
    ])
  })

  it('sends the trimmed live query to the host and shows its ranked rows', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    await source.candidates(proj('s1'), req('MAIN'))
    expect(payloads).toEqual([{ sessionId: 's1', query: 'MAIN' }])
    // The host ranked: the basename-prefix file first, the directory second.
    expect(await source.candidates(proj('s1'), req(' main '))).toEqual([
      { name: 'src/main.ts' },
    ])
    // 'src' matches the workspace directory, its two files, and the
    // reference's directory + file.
    expect(await source.candidates(proj('s1'), req('src'))).toEqual([
      { name: 'src/' },
      { name: 'myref/src/' },
      { name: 'src/main.ts' },
      { name: 'myref/src/inner.ts' },
      { name: 'src/utils.ts' },
    ])
  })

  it('lists the prefix directory first for a folder query, then its files', async () => {
    const { source } = await bench(listOk())
    expect(await source.candidates(proj('s1'), req('src/'))).toEqual([
      { name: 'src/' },
      { name: 'myref/src/' },
      { name: 'src/main.ts' },
      { name: 'myref/src/inner.ts' },
      { name: 'src/utils.ts' },
    ])
  })

  it('caps the menu at the usability bound', async () => {
    const big = Array.from({ length: 60 }, (_, i) => ({
      path: `/w/f${String(i).padStart(2, '0')}.txt`,
      relative: `f${String(i).padStart(2, '0')}.txt`,
      root: 'workspace' as const,
      isDirectory: false,
    }))
    const { source } = await bench(listOk(big))
    expect(await source.candidates(proj('s1'), req('f'))).toHaveLength(50)
  })

  it('rejects on a failed result', async () => {
    const { source } = await bench(() => Promise.resolve({
      result: { ok: false, error: { code: 'internal', message: 'boom', details: {} } },
    }))
    await expect(source.candidates(proj('s1'), req(''))).rejects.toThrow('files.list failed: internal: boom')
  })

  it('does not fetch for an addressed subagent session', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list, { addressed: sid('child') })
    await expect(source.candidates(proj('child'), req(''))).resolves.toEqual([])
    source.warm!(proj('child'))
    expect(payloads).toEqual([])
  })

  it('lists nothing for a provider chat (a connector-preset session carries no project)', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list, {
      byId: { prov: { agentPreset: 'preset-github' } },
      connectorPresetIds: new Set(['preset-github']),
    })
    await expect(source.candidates(proj('prov'), req(''))).resolves.toEqual([])
    source.warm!(proj('prov'))
    expect(payloads).toEqual([])
  })

  it('keeps listing for a session whose preset is not a connector preset', async () => {
    const { source } = await bench(listOk(), {
      byId: { s1: { agentPreset: 'preset-default' } },
      connectorPresetIds: new Set(['preset-github']),
    })
    expect(await source.candidates(proj('s1'), req(''))).toHaveLength(ROWS.length)
  })
})

describe('fetch cache', () => {
  it('one RPC per (session, query) key: the same query reuses, a new query refetches', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s1'), req('src'))
    await source.candidates(proj('s1'), req('src'))
    expect(payloads).toHaveLength(2)
    await source.candidates(proj('s2'), req(''))
    expect(payloads).toHaveLength(3)
  })

  it('single-flight: concurrent candidates on one cold key share one RPC', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    const [a, b] = await Promise.all([
      source.candidates(proj('s1'), req('main')),
      source.candidates(proj('s1'), req('main')),
    ])
    expect(payloads).toHaveLength(1)
    expect(a).toEqual([{ name: 'src/main.ts' }])
    expect(b).toEqual(a)
  })

  it('a newer live query aborts the earlier in-flight live fetch', async () => {
    const signals: (AbortSignal | undefined)[] = []
    let resolveFirst: (() => void) | undefined
    const list: ListFn = (_payload, signal) => {
      signals.push(signal)
      if (signals.length === 1) {
        return new Promise((result) => {
          resolveFirst = () => {
            result({ result: { ok: true as const, value: { files: [], truncated: false } } })
          }
        })
      }
      return listOk()(_payload, signal)
    }
    const { source } = await bench(list)
    const first = source.candidates(proj('s1'), req('a'))
    await vi.waitFor(() => { expect(signals).toHaveLength(1) })
    // A fresh keystroke: the first in-flight live fetch is superseded.
    const second = source.candidates(proj('s1'), req('ab'))
    await vi.waitFor(() => { expect(signals).toHaveLength(2) })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    resolveFirst?.()
    await Promise.all([first, second])
  })

  it('an aborted caller yields empty but leaves the shared fetch warm', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    const aborted = new AbortController()
    aborted.abort()
    await expect(source.candidates(proj('s1'), req('src', aborted.signal))).resolves.toEqual([])
    await expect(source.candidates(proj('s1'), req('src'))).resolves.toHaveLength(5)
    expect(payloads).toHaveLength(1)
  })

  it('matches a directory through a substring of its trailing-slash form and ranks it last', async () => {
    const rows: FileEntry[] = [
      ...ROWS,
      { path: '/w/xsrcy', relative: 'xsrcy', root: 'workspace', isDirectory: true },
    ]
    const { source } = await bench(listOk(rows))
    const items = await source.candidates(proj('s1'), req('src'))
    const names = items.map(i => i.name)
    expect(names).toContain('xsrcy/')
    expect(names.indexOf('xsrcy/')).toBeGreaterThan(names.indexOf('src/main.ts'))
  })

  it('scores a backslash-separated relative like its slash form (a Windows host)', async () => {
    // The host walks in the platform separator; the client re-rank must not
    // drop or mis-tier a '\' relative, and the display keeps the platform
    // separator the host served.
    const rows: FileEntry[] = [
      { path: '/w/src\\main.ts', relative: 'src\\main.ts', root: 'workspace', isDirectory: false },
      { path: '/w/src', relative: 'src', root: 'workspace', isDirectory: true },
    ]
    const { source } = await bench(listOk(rows))
    expect(await source.candidates(proj('s1'), req('main'))).toEqual([{ name: 'src\\main.ts' }])
    // A slash-typed query finds the backslash row too.
    expect(await source.candidates(proj('s1'), req('src'))).toEqual([
      { name: 'src/' },
      { name: 'src\\main.ts' },
    ])
  })

  it('drops rows the query excludes and orders key ties byte-wise over an unordered window', async () => {
    // A static window the host left unordered and unfiltered for the query:
    // the defensive re-rank drops the non-matching row (data.md carries no
    // 's') and orders the equal-tier tie by the byte-wise key.
    const rows: FileEntry[] = [
      { path: '/w/zz/s.txt', relative: 'zz/s.txt', root: 'workspace', isDirectory: false },
      { path: '/w/data.md', relative: 'data.md', root: 'workspace', isDirectory: false },
      { path: '/w/aa/s.txt', relative: 'aa/s.txt', root: 'workspace', isDirectory: false },
    ]
    const list: ListFn = () => Promise.resolve({
      result: { ok: true as const, value: { files: [...rows], truncated: false } },
    })
    const { source } = await bench(list)
    expect((await source.candidates(proj('s1'), req('s'))).map(i => i.name)).toEqual(['aa/s.txt', 'zz/s.txt'])
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
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(8)
    expect(payloads).toHaveLength(2)
  })

  it('serves a settled browse key from cache until the 15s TTL', async () => {
    vi.useFakeTimers()
    try {
      const { list, payloads } = countingList()
      const { source } = await bench(list)
      await source.candidates(proj('s1'), req(''))
      await source.candidates(proj('s1'), req(''))
      expect(payloads).toHaveLength(1)
      vi.setSystemTime(Date.now() + 10_000)
      await source.candidates(proj('s1'), req(''))
      expect(payloads).toHaveLength(1)
      vi.setSystemTime(Date.now() + 16_000)
      await source.candidates(proj('s1'), req(''))
      expect(payloads).toHaveLength(2)
      expect(payloads[1]).toEqual({ sessionId: 's1' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('serves a settled live key from cache only until the 2s TTL', async () => {
    vi.useFakeTimers()
    try {
      const { list, payloads } = countingList()
      const { source } = await bench(list)
      await source.candidates(proj('s1'), req('src'))
      await source.candidates(proj('s1'), req('src'))
      expect(payloads).toHaveLength(1)
      vi.setSystemTime(Date.now() + 1_000)
      await source.candidates(proj('s1'), req('src'))
      expect(payloads).toHaveLength(1)
      vi.setSystemTime(Date.now() + 3_000)
      await source.candidates(proj('s1'), req('src'))
      expect(payloads).toHaveLength(2)
      expect(payloads[1]).toEqual({ sessionId: 's1', query: 'src' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stale browse entry whose fetch fails after replacement keeps the newer entry', async () => {
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
      await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(8)
      rejectStale({ result: { ok: false, error: { code: 'internal', message: 'boom', details: {} } } })
      await stale
      // The replacement entry is intact: the stale failure dropped nothing.
      await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(8)
      expect(call).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the scope-birth warm prewarms the browse key fire-and-forget', async () => {
    const { list, payloads } = countingList()
    const { source } = await bench(list)
    source.warm!(proj('s1'))
    await vi.waitFor(() => { expect(payloads).toHaveLength(1) })
    expect(payloads[0]).toEqual({ sessionId: 's1' })
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(8)
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
    await expect(source.candidates(proj('s1'), req(''))).resolves.toHaveLength(8)
  })

  it('connection/reset clears every cached (session, query) key', async () => {
    const { list, payloads } = countingList()
    const { ctx, source } = await bench(list)
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s1'), req('src'))
    await source.candidates(proj('s2'), req(''))
    expect(payloads).toHaveLength(3)
    ctx.emit('connection/reset')
    await source.candidates(proj('s1'), req(''))
    await source.candidates(proj('s1'), req('src'))
    await source.candidates(proj('s2'), req(''))
    expect(payloads).toHaveLength(6)
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

  it('inserts a trailing slash for a directory pick', async () => {
    const { source } = await bench(listOk())
    await source.candidates(proj('s1'), req('src'))
    expect(source.onPick(pick('src/'))).toEqual({ text: '@src/ ' })
    expect(source.onPick(pick('myref/src/'))).toEqual({ text: '@/r/src/ ' })
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

  it('degrades to the display form when the pick outruns its own fetch', async () => {
    let resolveRows!: (rows: FileEntry[]) => void
    const pending = new Promise<FileEntry[]>((r) => { resolveRows = r })
    const list: ListFn = _payload => pending
      .then(rows => ({ result: { ok: true as const, value: { files: rows, truncated: false } } }))
    const { source } = await bench(list)
    const inflight = source.candidates(proj('s1'), req(''))
    // The (session, query) key is in flight, not settled: the row lookup
    // finds nothing and the pick degrades to the display form.
    expect(source.onPick(pick('src/main.ts'))).toEqual({ text: '@src/main.ts ' })
    resolveRows(ROWS)
    await inflight
  })
})
