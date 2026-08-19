/**
 * files domain contract: session-scoped bounded file enumeration for the
 * composer's `@` mention surface. The session's header cwd (the main
 * project) and its attached reference projects resolve host-side — the
 * client never submits a raw path — and listing never creates or resumes an
 * Agent.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One mentionable file: a regular file under the session's cwd or an attached reference project. */
export interface FileEntry {
  /** Canonical absolute host path (the pick's insertion form for reference files). */
  readonly path: string
  /** Path relative to its root (the pick's insertion form for main-project files). */
  readonly relative: string
  /** `'workspace'` for a main-project file, otherwise the reference root's basename. */
  readonly root: string
}

/**
 * Files-domain unary methods (the map key files.* of RpcMethodMap). Listing
 * is the domain's only RPC: a pick inserts a plain path into the draft
 * (the plain-text-reference decision), so every client shares one
 * deterministic path with no dedicated mention wire.
 */
export interface FilesApi {
  /**
   * Lists the session's mentionable files: a bounded walk of the session
   * cwd plus each attached reference project. The walk is files-only,
   * skips `.git` and `node_modules`, never follows directory symlinks,
   * and stops at its fixed bounds (depth 8, 1000 entries); `truncated`
   * reports the entry bound. A root that vanished since attachment is
   * skipped, not an error.
   */
  list(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ files: readonly FileEntry[]; truncated: boolean }>>
}
