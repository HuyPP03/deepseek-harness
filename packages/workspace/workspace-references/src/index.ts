/**
 * Session reference projects (`ctx.workspaceReferences`): the one home for
 * the additional project directories attached to a session for comparison. The attached set is whole-value log state — one
 * `workspace/references` event per change, the last event the fold — so
 * resume, fork, and replay carry it with the seed, and the
 * `workspace:references` prompt section rebuilds identically from the log
 * (model-visible ⟺ logged).
 *
 * References are readable under every confined mode: each confined backend
 * leaves the rest of the filesystem readable, so an admitted reference
 * directory is readable as-is by the fs tools and sandboxed execution
 * without any backend change. Writability follows the file policy:
 * `read-only` and `workspace-write` confine writes to the session workspace
 * (plus platform temp areas); only `workspace-refs-write` makes the attached
 * reference directories writable, and that mode's policy carries their
 * canonical paths as `referenceRoots`.
 *
 * Admission canonicalizes each path (realpath), requires an existing
 * directory, deduplicates, excludes the session's own cwd, and caps the set
 * at `Config.maxReferences`; a violation throws at the operation boundary
 * (fail loud, never a silent skip).
 *
 * @module @deepseek-ai/dsh-workspace-references
 */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import zod from 'zod'
// Type-only: resolves the declaration merges these types rely on.
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ReferenceProject, WorkspaceReferencesView } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The session reference-project service (absent when the package is not composed). */
    workspaceReferences: WorkspaceReferenceService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's reference-project set changed — log-only (like
     * `sandbox/mode`; NOT a surface event, carries no `surfaceOp`): durable
     * and replayable. WHOLE-VALUE: `references` is the complete attached set
     * after the change (an empty list detaches all); the LAST such event is
     * the session's current set. The `workspace:references` prompt section
     * renders the fold, so replay rebuilds the same model-visible text.
     */
    'workspace/references': {
      /** The complete reference set after the change: canonical absolute directory paths, in admission order, never the session cwd. */
      references: readonly ReferenceProject[]
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's reference-project fold for clients: the attached paths
     * plus the host's configured cap. Key absence means the capability is
     * uncomposed — clients hide the control.
     */
    workspaceReferences: WorkspaceReferencesView
  }
}

/**
 * The `workspace:references` prompt section's stable intro line. Model-facing
 * text is pinned verbatim; the dynamic part is the path list that follows it.
 */
export const REFERENCE_PROJECTS_INTRO =
  'Reference projects: these projects are attached to this session for comparison. '
  + 'Modify files under them only when the current file policy allows it.'

/**
 * Validate and canonicalize a raw reference list for one session: every entry
 * must be an existing absolute directory, the session's own cwd is the main
 * project and rejects, duplicates collapse to first-seen order, and the
 * result may not exceed the cap.
 * @param paths - candidate reference directories.
 * @param cwd - the session's workspace root, or undefined for a session without one.
 * @param max - the configured per-session cap.
 * @throws when an entry is not an existing directory, equals the session cwd, or the set exceeds the cap.
 * @returns canonical paths in first-seen order.
 */
export async function normalizeReferencePaths(paths: readonly string[], cwd: string | undefined, max: number): Promise<string[]> {
  const out: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(`workspace/references: every reference must be a non-empty path, got ${JSON.stringify(raw)}`)
    }
    if (!isAbsolute(raw)) {
      throw new Error(`workspace/references: references must be absolute paths: ${raw}`)
    }
    let canonical: string
    try {
      canonical = await realpath(resolve(raw))
    } catch {
      throw new Error(`workspace/references: reference does not exist: ${raw}`)
    }
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`workspace/references: reference is not a directory: ${raw}`)
    }
    if (cwd !== undefined) {
      let cwdCanonical: string
      try {
        cwdCanonical = await realpath(resolve(cwd))
      } catch {
        cwdCanonical = resolve(cwd)
      }
      if (canonical === cwdCanonical) {
        throw new Error(`workspace/references: ${raw} is the session workspace; a session cannot reference itself`)
      }
    }
    if (!out.includes(canonical)) out.push(canonical)
  }
  if (out.length > max) {
    throw new Error(`workspace/references: at most ${max} reference project(s) may be attached, got ${out.length}`)
  }
  return out
}

/**
 * The session's current reference set: the last `workspace/references`
 * event's paths, or none. The pure fold — replaying the log IS the state.
 * @param session - session whose log supplies the set.
 * @returns reference paths in admission order (never the session cwd).
 */
export function referencesOf(session: Session): readonly string[] {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index] as SessionEvent
    if (event.type === 'workspace/references') {
      return event.data.references.map(entry => entry.path)
    }
  }
  return []
}

/** Fold state between whole-value events. */
interface ReferenceState {
  readonly references: readonly string[]
}

/** The no-attachment fold (the projection `init` and the empty-log fact). */
const NO_REFERENCES: ReferenceState = { references: [] }

/**
 * One-event fold (the projection unit's `apply`). Uninterested events return
 * the same reference — the registry's change gate.
 * @param state - the folded state before `event`.
 * @param event - one committed session event.
 * @returns the next state; the same reference when the event is not a reference change.
 */
function applyReferenceEvent(state: ReferenceState, event: SessionEvent): ReferenceState {
  if (event.type !== 'workspace/references') return state
  const references = event.data.references.map(entry => entry.path)
  return references.length === 0 && state.references.length === 0 ? state : { references }
}

/** The service config. */
export interface Config {
  /** Maximum reference projects one session may attach (default 2). */
  readonly maxReferences?: number
}

/**
 * The `ctx.workspaceReferences` service: whole-value fold, validated write
 * path, model-facing prompt section, and the client projection. The prompt
 * section renders only while a session has references (an empty fold changes
 * no prompt — request-prefix stability); the projection key stays absent
 * (clients hide the control) when no projection registry is composed.
 */
export class WorkspaceReferenceService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    maxReferences: z.number().min(1).default(2),
  })

  static inject = ['sessions']

  /** The configured per-session reference cap. */
  readonly maxReferences: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'workspaceReferences')
    // schemastery already filled the default; the cast records that runtime fact.
    this.maxReferences = config.maxReferences as number
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'workspace:references',
        order: 115,
        text: (context) => {
          const session = context.agent?.session
          if (session === undefined) return ''
          const references = referencesOf(session)
          if (references.length === 0) return ''
          return [REFERENCE_PROJECTS_INTRO, ...references.map(path => `- ${path}`)].join('\n')
        },
      })
    })
    ctx.inject(['sessionProjections'], (projectionCtx: Context) => {
      projectionCtx.sessionProjections.register<'workspaceReferences', ReferenceState>({
        key: 'workspaceReferences',
        schema: viewSchema,
        init: () => NO_REFERENCES,
        apply: applyReferenceEvent,
        view: state => ({ references: [...state.references], limit: this.maxReferences }),
        stateVersion: 1,
      })
    })
  }

  /**
   * Replace the session's reference set (whole-value). Validates the request
   * (see {@link normalizeReferencePaths}) and appends one
   * `workspace/references` event; a request matching the current set appends
   * nothing. The new set reaches the model at the session's next prompt
   * assembly.
   * @param session - the session to attach to.
   * @param paths - the complete requested set (empty detaches all).
   */
  async set(session: Session, paths: readonly string[]): Promise<void> {
    const normalized = await normalizeReferencePaths(paths, session.header.cwd, this.maxReferences)
    const current = referencesOf(session)
    if (normalized.length === current.length && normalized.every((path, index) => current[index] === path)) return
    session.append('workspace/references', { references: normalized.map(path => ({ path })) })
  }
}

/**
 * The projection view schema (plain JSON; the whole current value). The cast
 * records the zod output-to-domain widening (`string[]` vs `readonly
 * string[]`) exactly as the JSON wire serializes it.
 */
const viewSchema = zod.object({
  references: zod.array(zod.string()),
  limit: zod.number().int().positive(),
}) as unknown as zod.ZodType<WorkspaceReferencesView>

export default WorkspaceReferenceService
