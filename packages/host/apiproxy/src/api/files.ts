/**
 * files domain contract: session-scoped bounded file and directory
 * enumeration for the composer's `@` mention surface. The session's header
 * cwd (the main project) and its attached reference projects resolve
 * host-side — the client never submits a raw path — and listing never
 * creates or resumes an Agent. The optional `query` filters and ranks the
 * walk's own enumeration host-side (the client's live @ token); it is a
 * filter, not a path the host resolves.
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

/**
 * Files-domain unary methods (the map key files.* of RpcMethodMap). Listing
 * is the domain's only RPC: a pick inserts a plain path into the draft
 * (the plain-text-reference decision), so every client shares one
 * deterministic path with no dedicated mention wire.
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
}
