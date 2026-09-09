/**
 * Session status presentation shared by the browsing rows and the chats
 * dashboard: pending interaction is primary and live activity outranks
 * completion reminders.
 */
import type { StateDotState } from '@open-harness/oh-client-ui-primitives'
import type { PendingInteractionStatus } from '@open-harness/oh-client-runtime/client'
import type { TranslateNS } from '@open-harness/oh-client-ui-slots'

/** One status chip: the StateDot state plus its localized label. */
export interface SessionStatus {
  state: StateDotState
  label: string
}

/** The session facts the status presentation derives from. */
export type SessionStatusInput = Pick<{
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  runningSubagentCount: number
  completed: boolean
}, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'>

/**
 * Derive the ordered status chips for one session row.
 * @param node - the session facts (see {@link SessionStatusInput}).
 * @param t - the workspace-namespace translate (the status.* keys).
 * @returns the chips, primary first (pending > running > subagents > done).
 */
export function sessionStatuses(
  node: SessionStatusInput,
  t: TranslateNS<'workspace'>,
): readonly [SessionStatus, ...SessionStatus[]] {
  const subagents: SessionStatus | undefined = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningSubagentCount === 1
          ? 'status.subagentsRunning.one'
          : 'status.subagentsRunning.other',
        { n: node.runningSubagentCount },
      ),
    }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = { state: 'warning', label: t('status.waitingApproval') }
      break
    case 'plan-review':
      pending = { state: 'warning', label: t('status.planReview') }
      break
    case 'question':
      pending = { state: 'warning', label: t('status.waitingAnswer') }
      break
    case undefined: break
    /* v8 ignore next -- closed PendingInteractionStatus union */
    default:
      throw new Error(`unknown pending interaction: ${String(node.pendingInteraction)}`)
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}
