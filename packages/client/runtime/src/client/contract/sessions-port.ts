/**
 * Cross-domain sessions face: the contract surface sibling domains (today:
 * workspaces) consume instead of the sessions implementation. The sessions
 * domain satisfies it structurally — SessionRuntime is assignable, checked
 * wherever the assembly layer or a test injects the real service — so
 * widening this face is the explicit act of widening the inter-domain
 * dependency.
 */

import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from './store.ts'

/** Session-list row facts sibling domains read: recency, blank-reuse eligibility, its cwd canon, and the preset that created it. */
export interface SessionsPortSummary {
  id: SessionId
  /** Empty-log bit (blank sessions are reused by New Session instead of minting another). */
  blank: boolean
  cwd?: string
  /** Agent preset that created the session; chat-reuse and preset-scoped UI branch on it. */
  agentPreset?: string
  updatedAt: number
}

/** Session-list facts sibling domains read: readiness, selection, and the row map. */
export interface SessionsPortList {
  ids: SessionId[]
  byId: Record<SessionId, SessionsPortSummary>
  current: SessionId | undefined
  phase: 'pending' | 'ready'
}

/** The sessions-service face injected into sibling domains. */
export interface SessionsPort {
  /** Observable list snapshot (read face only; writes stay inside the sessions domain). */
  readonly list: ObservableSnapshot<SessionsPortList>
  /**
   * Create a session on the host.
   * @param opts - target workspace (absent → plain chat on the host's cwd),
   *   the optional reference-project ids (whole value; the host normalizes
   *   and logs the workspace/references event), and the optional agent preset
   *   the session is born under (absent → the deployment default).
   * @returns the new session id.
   */
  create(opts: {
    workspaceId?: WorkspaceId
    referenceWorkspaceIds?: readonly WorkspaceId[]
    agentPreset?: string
  }): Promise<SessionId>
  /**
   * Select a session as current.
   * @param id - session id (must exist in the list store).
   */
  open(id: SessionId): void
  /** Clear the current selection into the no-session view state. */
  clear(): void
}
