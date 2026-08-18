/**
 * Public type vocabulary of the session reference-project domain: the
 * `workspace/references` session event, the reference record, and the
 * `workspaceReferences` session-projection key. Types only — the service,
 * fold, and write path live in `index.ts` (this file carries no runtime
 * code).
 *
 * @module @deepseek-ai/dsh-workspace-references/src/types
 */

/**
 * One reference project attached to a session: a canonical absolute
 * directory path the agent may read for comparison. Read-only by the
 * composition's standing sandbox policy — a reference is never a writable
 * root; the session's own `header.cwd` workspace remains the only place
 * changes land.
 */
export interface ReferenceProject {
  /** Canonical absolute directory path (realpath-resolved at admission). */
  readonly path: string
}

/**
 * The current reference-project fold plus the host's configured cap — the
 * plain-JSON value clients read without folding the log.
 */
export interface WorkspaceReferencesView {
  /** Attached reference paths, in admission order. */
  readonly references: readonly string[]
  /** The host's configured maximum number of references per session. */
  readonly limit: number
}
