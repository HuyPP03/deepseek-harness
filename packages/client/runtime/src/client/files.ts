/**
 * File byte facade for the browser runtime: the conversation file
 * inspector's preview and code surfaces read one session-scoped file's
 * verbatim bytes through the host's raw channel (GET /api/file, the
 * physical route the carrier answers without a wire envelope) instead of
 * fetching twice per tab. Reads are deduped in flight and cached in a
 * bounded LRU (32 entries, 16 MiB of bytes — the protocol constants, not
 * deployment tunables), so a large file the user already opened costs one
 * download per session, and an oversized single file is never cached.
 * Preview surfaces that want the browser's own decode (images, documents)
 * use the same URL shape directly and bypass the JS copy.
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** Maximum cached entries (protocol constant of the inspector cache). */
export const FILE_BYTES_MAX_ENTRIES = 32
/** Maximum cached bytes across every entry (protocol constant of the inspector cache). */
export const FILE_BYTES_MAX_BYTES = 16 * 1024 * 1024

/** One cached raw file view. */
export interface FileByteView {
  /** Canonical absolute host path the bytes were read from. */
  readonly path: string
  /** The verbatim bytes within the raw channel's 25 MiB bound. */
  readonly bytes: Uint8Array
  /** The response's content type (the host's curated extension map). */
  readonly contentType: string
  /** Whole-file size in bytes. */
  readonly size: number
}

/** A raw channel refusal the inspector can display (status is the HTTP code). */
export class FileBytesError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'FileBytesError'
  }
}

/** The file-bytes face sibling code injects (read/url/invalidate only). */
export interface FileBytesFace {
  /**
   * URL of one file's raw channel (preview surfaces point img/iframe/src
   * here directly; the browser decodes without a JS copy).
   * @param sessionId - the session that owns the working set.
   * @param path - the file's canonical absolute path.
   * @param download - true serves an attachment disposition.
   * @returns the same-origin URL string.
   */
  readonly url: (sessionId: SessionId, path: string, download?: boolean) => string
  /**
   * Read one file's bytes (cached; concurrent reads share one fetch).
   * @param sessionId - the session that owns the working set.
   * @param path - the file's canonical absolute path.
   * @param signal - optional cancellation for the underlying fetch.
   * @returns the cached or fetched view.
   * @throws FileBytesError when the raw channel refuses (403/404/413/500).
   */
  readonly read: (sessionId: SessionId, path: string, signal?: AbortSignal) => Promise<FileByteView>
  /**
   * Drop one cached view (call it when a session's file mutation lands).
   * @param sessionId - the session that owns the working set.
   * @param path - the file's canonical absolute path.
   */
  readonly invalidate: (sessionId: SessionId, path: string) => void
}

/** The runtime service: the face plus a full clear for fiber teardown tests. */
export interface FileBytesService extends FileBytesFace {
  /** Drop every cached view (and every in-flight dedupe slot). */
  clear(): void
}

/**
 * Build the file-bytes service. The fetch implementation is injectable so
 * tests (and fixture-mode hosts) steer the transport; production uses the
 * browser's globalThis.fetch against the same-origin raw channel.
 * @param options - the fetch implementation (default globalThis.fetch).
 * @returns the service face.
 */
export function createFileBytesService(options?: { fetchImpl?: typeof fetch }): FileBytesService {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  const entries = new Map<string, FileByteView>()
  let totalBytes = 0
  const inFlight = new Map<string, Promise<FileByteView>>()

  const keyOf = (sessionId: SessionId, path: string): string => `${String(sessionId)}\u0000${path}`

  const evictToBound = (): void => {
    // Map iteration is insertion order; the tail is the least recently used.
    for (const [key, view] of entries) {
      if (entries.size <= FILE_BYTES_MAX_ENTRIES && totalBytes <= FILE_BYTES_MAX_BYTES) break
      entries.delete(key)
      totalBytes -= view.bytes.byteLength
    }
  }

  const store = (sessionId: SessionId, path: string, view: FileByteView): void => {
    // A store only follows a cache miss, so the key is absent from the map.
    // An oversized single file is served once, never cached (it would
    // evict the whole bound on every rotation).
    if (view.bytes.byteLength > FILE_BYTES_MAX_BYTES) return
    entries.set(keyOf(sessionId, path), view)
    totalBytes += view.bytes.byteLength
    evictToBound()
  }

  const url = (sessionId: SessionId, path: string, download?: boolean): string =>
    `/api/file/${encodeURIComponent(String(sessionId))}/${encodeURIComponent(path)}${download ? '?download=1' : ''}`

  const read = async (sessionId: SessionId, path: string, signal?: AbortSignal): Promise<FileByteView> => {
    const key = keyOf(sessionId, path)
    const cached = entries.get(key)
    if (cached !== undefined) {
      // Refresh the recency order on a hit.
      entries.delete(key)
      entries.set(key, cached)
      return cached
    }
    const pending = inFlight.get(key)
    if (pending !== undefined) return pending
    const attempt = (async () => {
      const response = await fetchImpl(url(sessionId, path), { ...(signal !== undefined ? { signal } : {}) })
      if (!response.ok) {
        throw new FileBytesError(response.status, `file read failed with status ${response.status}`)
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const view: FileByteView = {
        path,
        bytes,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        size: Number(response.headers.get('content-length') ?? bytes.byteLength),
      }
      store(sessionId, path, view)
      return view
    })()
    inFlight.set(key, attempt)
    try {
      return await attempt
    } finally {
      // This attempt owns the slot until it settles: no other read of the
      // same key can replace it (concurrent readers join the pending slot).
      inFlight.delete(key)
    }
  }

  const invalidate = (sessionId: SessionId, path: string): void => {
    const key = keyOf(sessionId, path)
    const existing = entries.get(key)
    if (existing !== undefined) {
      entries.delete(key)
      totalBytes -= existing.bytes.byteLength
    }
  }

  return {
    url,
    read,
    invalidate,
    clear: () => {
      entries.clear()
      inFlight.clear()
      totalBytes = 0
    },
  }
}
