// Shared JobView presentation helpers: the header list rows and the details
// log seat both read the same wire status set, so the marker, the status word,
// and the liveness test live here once.

import type { JobView } from '@deepseek-ai/dsh-client-runtime/client'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * A job the registry still holds open, and whose duration therefore ticks.
 * @param job - the wire view to test.
 * @returns true for `running` or `stopping`.
 */
export function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Closed-union exhaustiveness fence for the wire status set. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled job status: ${JSON.stringify(value)}`)
}

/**
 * Status marker semantics. `stopping` and `killed` share the attention color:
 * both mean the work ended (or is ending) on request rather than on its own.
 * @param status - the wire status to render.
 * @returns the StateDot state for the marker.
 */
export function dotState(status: JobView['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/**
 * Human status word for the row and its accessible name.
 * @param status - the wire status to label.
 * @param t - the package `job` namespace translator.
 * @returns the localized status word.
 */
export function statusLabel(status: JobView['status'], t: TranslateNS<'job'>): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'killed': return t('status.killed')
    case 'failed': return t('status.failed')
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/**
 * The registry no longer holds the selected job: the id is unknown, or the
 * settled job was released. The details seat renders the released state
 * instead of a generic failure.
 */
export class JobNotFoundError extends Error {}
