/** Package-owned reference-project event invariants. @module @deepseek-ai/dsh-workspace-references/invariant */

import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-workspace-references'

/** Cordis companion plugin name. */
export const name = 'workspace-references-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one reference event's owned relationship: every reference is a
 * non-empty absolute path and none equals the session's own workspace root
 * (the fold's self-exclusion guarantee, checked on the authoritative event
 * stream rather than on service state).
 */
function validateEvent(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'workspace/references') return
  const cwd = session.header.cwd
  for (const reference of event.data.references) {
    if (typeof reference.path !== 'string' || reference.path.length === 0 || !isAbsolute(reference.path)) {
      fail(`workspace/references carries a non-absolute path ${JSON.stringify(reference.path)}`)
      /* v8 ignore next -- InvariantFailure always throws, so the skip cannot execute. */
      continue
    }
    if (cwd !== undefined && reference.path === cwd) {
      fail(`workspace/references names the session's own workspace as a reference: ${reference.path}`)
    }
  }
}

/** Install validation that loaded and newly appended reference events stay well-formed. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(session, event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the workspace-references invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
