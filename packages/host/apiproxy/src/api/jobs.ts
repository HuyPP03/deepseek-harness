/**
 * Browser-safe background-job domain contract. The registry's live records
 * never cross the wire; a view is the subset a human list needs, minted fresh
 * per push.
 */

import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Retained job log served to one details-panel poll. The host tail-bounds
 * the registry's retained log to this many UTF-8 bytes (the wire value is a
 * human surface, never model-facing). Fixed value, documented here as wire
 * contract.
 */
export const JOB_LOG_WIRE_TAIL_BYTES = 262_144

/**
 * One background job as the client sees it.
 *
 * Three registry fields are deliberately absent. `ownerSession` is redundant
 * beside the frame's own `sessionId`; `reported` is an internal notice-delivery
 * bit with no user meaning; `outputLimitBytes` is producer-owned model
 * presentation policy that never reaches a human surface.
 */
export interface JobView {
  /** Registry-issued `<kind>-N` identity, stable for the task's whole life. */
  id: JobId
  /**
   * Producer kind (`bash`, `pwsh`, `pty-send`, `subagent`, …). Kept as a bare
   * string because producer plugins extend the kind map by declaration merging,
   * so no client build can enumerate the closed set.
   */
  kind: string
  /** Producer-supplied one-line label: the command, or the delegation description. */
  label: string
  /** Current lifecycle state. */
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  /** Kind-specific status detail ('exit code: 3'), present once the producer supplied one. */
  detail?: string
  /** Epoch ms when the task was registered. */
  startedAt: number
  /** Epoch ms when the task settled; absent while live. */
  finishedAt?: number
}

/**
 * One retained job log, served to the human details panel. Human-facing by
 * design: the host tail-bounds the registry's retained log to
 * {@link JOB_LOG_WIRE_TAIL_BYTES} UTF-8 bytes before encoding.
 */
export interface JobLogView {
  /**
   * The retained tail of the job's drained output. For final-output jobs
   * (no stream) this is the settled output once terminal, empty before.
   */
  text: string
  /**
   * True when the host tail-truncated the retained log to fit the wire bound.
   * The registry's own retention marker (if any) stays inside `text`.
   */
  truncated: boolean
}

/**
 * Job-domain unary methods. Reads only: the client mirror is fed by
 * `session/jobs` push frames; `log` serves the details panel's polling read
 * of the retained log. Both resolve the requesting session's Agent so the
 * registry fence rejects a foreign session the same way `job_output` does.
 */
export interface JobsApi {
  /**
   * Read one job's retained log for the details panel. Non-consuming: it
   * never advances the model's read cursor nor marks the job reported. The
   * requesting session's live Agent is the fence caller, resolved like the
   * `session/jobs` frames: a session with no live Agent reads unowned jobs
   * only and is never resumed.
   * @param request - the requesting session and the target job id.
   * @returns the retained log tail, UTF-8-bounded by the wire constant.
   * @throws `job-not-found` when the registry holds no record under the id,
   * `job-unauthorized` when the fence rejects the session, and `internal`
   * when the deployment composes no job registry.
   */
  log(request: RpcRequest<{ sessionId: SessionId; jobId: JobId }>):
  Promise<RpcResponse<JobLogView>>
}
