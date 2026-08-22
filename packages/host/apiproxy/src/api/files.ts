/**
 * files domain contract: session-scoped bounded file, directory, and content
 * access for the composer's `@` mention surface and the conversation's file
 * inspector. The session's header cwd (the main project) and its attached
 * reference projects resolve host-side — the client never submits a raw path
 * the host would trust — and listing never creates or resumes an Agent. The
 * optional `query` filters and ranks the walk's own enumeration host-side
 * (the client's live @ token); it is a filter, not a path the host resolves.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One mentionable entry: a file or directory under the session's cwd or an attached reference project. */
export interface FileEntry {
  /** Canonical absolute host path (the pick's insertion form for reference entries). */
  readonly path: string
  /** Path relative to its root (the pick's insertion form for main-project entries). */
  readonly relative: string
  /** `'workspace'` for a main-project entry, otherwise the reference root's basename. */
  readonly root: string
  /** True for a directory (the menu renders a trailing slash and the pick inserts one). */
  readonly isDirectory: boolean
}

/** One bounded file view: the inspector's code surface for a contained file. */
export interface FileRead {
  /** Canonical absolute host path that was read. */
  readonly path: string
  /** Decoded content within the read's bounds (empty for a binary or empty file). */
  readonly content: string
  /** Complete lines in the served content. */
  readonly lines: number
  /** True when a bound (2 MiB or 20000 lines) cut the read short. */
  readonly truncated: boolean
  /** True when the leading bytes show a NUL; content is empty in that case. */
  readonly binary: boolean
  /** Whole-file size in bytes (independent of the served bounds). */
  readonly size: number
}

/**
 * Files-domain unary methods (the map key files.* of RpcMethodMap). Listing
 * is the mention surface's RPC: a pick inserts a plain path into the draft
 * (the plain-text-reference decision), so every client shares one
 * deterministic path with no dedicated mention wire. Reading is the
 * inspector's RPC: a contained file's bounded decoded view.
 */
export interface FilesApi {
  /**
   * Lists the session's mentionable files and directories: a bounded walk
   * of the session cwd plus each attached reference project. The walk skips
   * every dot-prefixed entry plus the curated directory-basename list in
   * `src/files-skip.json`, never follows symlinks, and stops at its fixed
   * bounds (depth 8, 20000 scanned entries, 100 result rows); `truncated`
   * reports the scan bound. An optional case-insensitive `query` filters
   * and ranks rows host-side (basename prefix beats path prefix beats
   * substring; '/' and '\' are the same separator) and prunes the walk when
   * it ends in a separator (a validated directory prefix). A root that
   * vanished since attachment is skipped, not an error. The optional
   * `signal` cancels the walk (a superseded keystroke must not keep the
   * host walking); a cancellation reports the partial result.
   */
  list(
    request: RpcRequest<{ sessionId: SessionId; query?: string }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ files: readonly FileEntry[]; truncated: boolean }>>
  /**
   * Reads one contained file as a bounded decoded view (2 MiB or 20000
   * lines, whichever comes first; `truncated` reports the cut). The `path`
   * is a list row's canonical path: the host proves it resolves inside the
   * session cwd or an attached reference project, lexically and after
   * symlink resolution — an outside landing is `file-path-escape`, a
   * vanished path is `file-not-found`, a directory is `file-is-directory`,
   * and a permission-denied read is `file-unreadable`. A NUL in the leading
   * bytes serves `binary: true` with empty content; `size` is the whole
   * file either way.
   */
  read(request: RpcRequest<{ sessionId: SessionId; path: string }>): Promise<RpcResponse<FileRead>>
  /**
   * Serves one contained file's verbatim bytes as a raw HTTP response —
   * the inspector's preview/download channel (GET /api/file). Host-only:
   * the carrier's physical route answers this directly, and the browser
   * never calls it as an RPC. The same working-set admission gates the
   * read (an outside landing refuses before any byte is produced), the
   * stat size answers 413 above the 25 MiB bound, and the content type is
   * a curated extension map with an inert application/octet-stream
   * fallback under X-Content-Type-Options: nosniff. `download` switches
   * the response to an attachment disposition.
   * @param request - the session id, a list row's canonical path, and the
   * attachment flag.
   * @param signal - cancellation for the underlying stream.
   * @returns the raw response; 404 unknown session or vanished file, 403
   * outside the working set, 413 over the bound, 500 unreadable.
   */
  raw(
    request: { sessionId: SessionId; path: string; download?: boolean },
    signal: AbortSignal,
  ): Promise<Response>
}
