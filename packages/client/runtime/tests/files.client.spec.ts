/**
 * File byte facade: raw channel URL building, in-flight read dedupe, the
 * bounded LRU (32 entries / 16 MiB), the oversized-single-file exemption,
 * recency promotion, and invalidation. The transport is injected, so the
 * suite steers the response without a server.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createFileBytesService,
  FileBytesError,
  FILE_BYTES_MAX_BYTES,
  FILE_BYTES_MAX_ENTRIES,
} from '../src/client/files.ts'

const sid = (id: string): SessionId => id as SessionId

function fetchImpl(make: () => Response): { fetch: typeof fetch; calls: () => number } {
  const calls = vi.fn(() => Promise.resolve(make()))
  return { fetch: calls, calls: () => calls.mock.calls.length }
}

function okResponse(bytes: Uint8Array<ArrayBuffer>, contentType: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) },
  })
}

describe('fileBytes.url', () => {
  it('builds the raw channel URL with an encoded path segment', () => {
    const service = createFileBytesService()
    expect(service.url(sid('sid-1'), '/tmp/proj/a b/c.md')).toBe('/api/file/sid-1/%2Ftmp%2Fproj%2Fa%20b%2Fc.md')
  })

  it('appends the download switch when asked', () => {
    const service = createFileBytesService()
    expect(service.url(sid('sid-1'), '/tmp/p.txt', true)).toBe('/api/file/sid-1/%2Ftmp%2Fp.txt?download=1')
    expect(service.url(sid('sid-1'), '/tmp/p.txt', false)).not.toContain('?download')
  })
})

describe('fileBytes.read', () => {
  it('serves the fetched view with headers and caches it', async () => {
    const bytes = new TextEncoder().encode('body\n')
    const { fetch, calls } = fetchImpl(() => okResponse(bytes, 'text/plain; charset=utf-8'))
    const service = createFileBytesService({ fetchImpl: fetch })

    const first = await service.read(sid('sid-1'), '/tmp/a.txt')
    expect(first.path).toBe('/tmp/a.txt')
    expect(new TextDecoder().decode(first.bytes)).toBe('body\n')
    expect(first.contentType).toBe('text/plain; charset=utf-8')
    expect(first.size).toBe(5)

    await service.read(sid('sid-1'), '/tmp/a.txt')
    expect(calls()).toBe(1)
  })

  it('shares one fetch across concurrent reads of the same key', async () => {
    const bytes = new TextEncoder().encode('x')
    const { fetch, calls } = fetchImpl(() => okResponse(bytes, 'text/plain'))
    const service = createFileBytesService({ fetchImpl: fetch })

    const [a, b] = await Promise.all([service.read(sid('sid-1'), '/tmp/a'), service.read(sid('sid-1'), '/tmp/a')])
    expect(calls()).toBe(1)
    expect(a).toBe(b)
  })

  it('falls back when the response carries no content headers', async () => {
    const bytes = new TextEncoder().encode('x')
    const fetchMock = vi.fn(async () => new Response(bytes))
    const service = createFileBytesService({ fetchImpl: fetchMock as unknown as typeof fetch })

    const view = await service.read(sid('sid-1'), '/tmp/plain')
    expect(view.contentType).toBe('application/octet-stream')
    expect(view.size).toBe(1)
  })

  it('throws a FileBytesError carrying the refusal status', async () => {
    const { fetch } = fetchImpl(() => new Response('refused', { status: 413 }))
    const service = createFileBytesService({ fetchImpl: fetch })

    await expect(service.read(sid('sid-1'), '/tmp/big.bin')).rejects.toThrow(FileBytesError)
    await expect(service.read(sid('sid-1'), '/tmp/big.bin')).rejects.toSatisfy(
      (error: unknown) => error instanceof FileBytesError && error.status === 413,
    )
  })

  it('re-fetches after a refusal (failures are not cached)', async () => {
    const refused = new Response('nope', { status: 404 })
    const calls = vi.fn(async () => refused)
    const service = createFileBytesService({ fetchImpl: calls as unknown as typeof fetch })

    await expect(service.read(sid('sid-1'), '/tmp/a')).rejects.toSatisfy((e: unknown) => (e as FileBytesError).status === 404)
    await expect(service.read(sid('sid-1'), '/tmp/a')).rejects.toSatisfy((e: unknown) => (e as FileBytesError).status === 404)
    expect(calls.mock.calls.length).toBe(2)
  })
})

describe('fileBytes LRU bound', () => {
  it('evicts the least recently used entry beyond the entry bound', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const label = url.slice(-1)
      const bytes = new TextEncoder().encode(`file-${label}`)
      return new Response(bytes, { status: 200, headers: { 'content-type': 'text/plain', 'content-length': String(bytes.byteLength) } })
    })
    const service = createFileBytesService({ fetchImpl: fetchMock as unknown as typeof fetch })

    for (let i = 0; i < FILE_BYTES_MAX_ENTRIES; i += 1) {
      await service.read(sid('sid-1'), `/tmp/f${i}`)
    }
    // The next read evicts the tail (f0) and stays within the bound.
    await service.read(sid('sid-1'), '/tmp/overflow')
    expect(fetchMock.mock.calls.length).toBe(FILE_BYTES_MAX_ENTRIES + 1)
    // Re-reading f0 misses the cache (a fresh fetch).
    await service.read(sid('sid-1'), '/tmp/f0')
    expect(fetchMock.mock.calls.length).toBe(FILE_BYTES_MAX_ENTRIES + 2)
  })

  it('promotes a hit so the eviction skips it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const bytes = new TextEncoder().encode(url)
      return new Response(bytes, { status: 200, headers: { 'content-type': 'text/plain', 'content-length': String(bytes.byteLength) } })
    })
    const service = createFileBytesService({ fetchImpl: fetchMock as unknown as typeof fetch })

    await service.read(sid('sid-1'), '/tmp/keep')
    for (let i = 1; i <= 30; i += 1) {
      await service.read(sid('sid-1'), `/tmp/f${i}`)
    }
    await service.read(sid('sid-1'), '/tmp/f31')
    // A hit on the oldest entry moves it to the most-recent end.
    await service.read(sid('sid-1'), '/tmp/keep')
    // The next insertion evicts f1 (now the least recently used), not keep.
    await service.read(sid('sid-1'), '/tmp/overflow')
    await service.read(sid('sid-1'), '/tmp/keep')
    expect(fetchMock.mock.calls.length).toBe(FILE_BYTES_MAX_ENTRIES + 1)
    await service.read(sid('sid-1'), '/tmp/f1')
    expect(fetchMock.mock.calls.length).toBe(FILE_BYTES_MAX_ENTRIES + 2)
  })

  it('evicts beyond the byte bound', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const fetchMock = vi.fn(async () => {
      return new Response(chunk, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(chunk.byteLength) } })
    })
    const service = createFileBytesService({ fetchImpl: fetchMock as unknown as typeof fetch })

    const needed = Math.floor(FILE_BYTES_MAX_BYTES / chunk.byteLength)
    for (let i = 0; i < needed; i += 1) {
      await service.read(sid('sid-1'), `/tmp/b${i}`)
    }
    // One more MiB pushes the total over the bound: the tail is evicted.
    await service.read(sid('sid-1'), '/tmp/overflow')
    await service.read(sid('sid-1'), '/tmp/b0')
    expect(fetchMock.mock.calls.length).toBe(needed + 2)
  })

  it('serves an oversized single file without caching it', async () => {
    const big = new Uint8Array(FILE_BYTES_MAX_BYTES + 1)
    const fetchMock = vi.fn(async () => {
      return new Response(big, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(big.byteLength) } })
    })
    const service = createFileBytesService({ fetchImpl: fetchMock as unknown as typeof fetch })

    const view = await service.read(sid('sid-1'), '/tmp/huge.bin')
    expect(view.size).toBe(FILE_BYTES_MAX_BYTES + 1)
    await service.read(sid('sid-1'), '/tmp/huge.bin')
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('drops an entry on invalidate and re-fetches on the next read', async () => {
    const bytes = new TextEncoder().encode('v1')
    const { fetch, calls } = fetchImpl(() => okResponse(bytes, 'text/plain'))
    const service = createFileBytesService({ fetchImpl: fetch })

    await service.read(sid('sid-1'), '/tmp/mutated')
    service.invalidate(sid('sid-1'), '/tmp/mutated')
    await service.read(sid('sid-1'), '/tmp/mutated')
    expect(calls()).toBe(2)
  })

  it('treats invalidating an uncached path as a no-op', async () => {
    const service = createFileBytesService({ fetchImpl: fetchImpl(() => okResponse(new Uint8Array(1), 'text/plain')).fetch })
    expect(() => {
      service.invalidate(sid('sid-1'), '/tmp/never-read')
    }).not.toThrow()
  })

  it('clears every entry on clear()', async () => {
    const bytes = new TextEncoder().encode('x')
    const { fetch, calls } = fetchImpl(() => okResponse(bytes, 'text/plain'))
    const service = createFileBytesService({ fetchImpl: fetch })

    await service.read(sid('sid-1'), '/tmp/a')
    await service.read(sid('sid-1'), '/tmp/b')
    service.clear()
    await service.read(sid('sid-1'), '/tmp/a')
    await service.read(sid('sid-1'), '/tmp/b')
    expect(calls()).toBe(4)
  })

  it('scopes the cache by session', async () => {
    const bytes = new TextEncoder().encode('same')
    const { fetch, calls } = fetchImpl(() => okResponse(bytes, 'text/plain'))
    const service = createFileBytesService({ fetchImpl: fetch })

    await service.read(sid('sid-1'), '/tmp/same')
    await service.read(sid('sid-2'), '/tmp/same')
    expect(calls()).toBe(2)
  })
})
