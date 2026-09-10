/**
 * Background-job plugin, browser half: contributes one session-header action
 * that renders this session's jobs (the data arrives entirely through the
 * `jobsBySession` list mirror), and occupies the details panel's job-log seat
 * for a clicked row. The seat's log bytes come from the connection's
 * `jobs.log` unary; the row's open gesture comes from ui-conversation's
 * `detailsPanel` service, read at call time so apply order relative to it
 * stays unconstrained.
 */
import type { ClientContext, SessionId } from '@open-harness/oh-client-runtime/client'
import type { ConnectionHandle } from '@open-harness/oh-api-remotes/client'
import type { JobId } from '@open-harness/oh-jobs/brand'
import type {} from '@open-harness/oh-client-ui-conversation/client'
import type {} from '@open-harness/oh-client-locale/client'
import { JobDetailPanel } from './JobDetailPanel.tsx'
import { JobListAction } from './JobListAction.tsx'
import { en, NS, vi, zh, type JobKey } from './locales.ts'
import { JobNotFoundError } from './job-view.ts'

declare module '@open-harness/oh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job list copy. */
    'job': JobKey
  }
}

export type { JobDetailPanelInjected, JobDetailPanelProps, JobLogRead } from './JobDetailPanel.tsx'
export type { JobListActionInjected, JobListActionProps } from './JobListAction.tsx'

/** Required services for locale registration, header-slot contribution, and the log read. */
export const inject = ['sessions', 'slots', 'locale', 'connection']

/**
 * Client plugin body: register the dictionaries, the composer-tool-row
 * action, and the details-panel job seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, vi, zh }), 'ui-job: dictionaries')
  ctx.slots.inject(
    'conversation.input.right',
    () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'job-list',
      // After the subagent catalog: session lineage reads before process work.
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId) => ({
        openJob: (jobId: string) => {
          ctx.get('detailsPanel')?.open(sessionId, { turnSeq: 0, jobId })
        },
      }),
    }, JobListAction),
  )
  ctx.slots.inject(
    'conversation.details.job',
    () => ctx.slots.register({
      name: 'conversation.details.job',
      locale: NS,
      inject: (sessionId: SessionId) => ({
        readJob: (jobId: string, signal: AbortSignal) =>
          (ctx.get('connection') as ConnectionHandle).api.jobs.log(
            { sessionId, jobId: jobId as JobId },
            signal,
          ).then((response) => {
            const { result } = response
            if (!result.ok) {
              if (result.error.code === 'job-not-found') throw new JobNotFoundError()
              throw new Error(`jobs.log failed: ${result.error.code}`)
            }
            return result.value
          }),
      }),
    }, JobDetailPanel),
  )
}
