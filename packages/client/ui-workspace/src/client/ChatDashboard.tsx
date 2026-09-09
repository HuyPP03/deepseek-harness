/**
 * Chats dashboard: the full-column center overlay behind the header's Chats
 * tab. Lists the recent ungrouped chats (the same row semantics as the
 * sidebar's Chats tab — deriveChats) newest-first, with the New chat call to
 * action. A row click opens the session; the header's session-open sync then
 * carries the center back to the conversation.
 */
import { useMemo } from 'react'
import { Button, IconPlusOutline16, OpenMark, StateDot } from '@open-harness/oh-client-ui-primitives'
import { workspaceTitleOf } from '@open-harness/oh-client-runtime/client'
import type { ChatDashboardProps } from './contract/slots.ts'
import type { SessionNode } from './tree.ts'
import { deriveChats, relativeTime } from './tree.ts'
import { sessionStatuses } from './session-status.ts'
import css from './ChatDashboard.module.css'

/** Row display title: blank rows show the localized New Chat (or New Session) label. */
function displayTitle(node: SessionNode, t: ChatDashboardProps['t']): string {
  if (node.blank) return node.blankChat ? t('chat.new') : t('session.new')
  return node.title
}

/** Localized compact relative time (e.g. `now` / `5 min` in en). */
function timeLabel(node: SessionNode, t: ChatDashboardProps['t']): string {
  const { unit, n } = relativeTime(node.updatedAt, Date.now())
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/**
 * Render the chats dashboard.
 * @param props - composed slot props (global seats + injected actions + bound preset hook + locale seat).
 * @returns the dashboard element tree.
 */
export function ChatDashboard({
  t,
  useSessions,
  useWorkspaces,
  openSession,
  startChat,
  useConnectorPresetIds,
}: ChatDashboardProps) {
  const list = useSessions(s => s)
  const workspaces = useWorkspaces(w => w)
  const connectorPresetIds = useConnectorPresetIds(ids => ids)
  // Recency-ordered (not the sidebar's manual order): the dashboard is the
  // recent-chats overview, the sidebar keeps the curated list.
  const rows = useMemo(
    () => deriveChats(list, workspaces.items, workspaces.archivedSessionIds, undefined, connectorPresetIds),
    [list, workspaces.items, workspaces.archivedSessionIds, connectorPresetIds],
  )
  return (
    <div className={css.dash}>
      <div className={css.head}>
        <div className={css.headLeft}>
          <h1 className={css.title}>{t('dashboard.title')}</h1>
          {rows.length > 0 && (
            <span className={css.count}>
              {t(rows.length === 1 ? 'dashboard.count.one' : 'dashboard.count.other', { n: rows.length })}
            </span>
          )}
        </div>
        <Button variant="primary" onClick={() => { startChat() }} icon={<IconPlusOutline16 size={16} />}>
          {t('chat.new')}
        </Button>
      </div>
      <div className={css.listScroll}>
        {rows.length === 0
          ? <div className={css.empty}><OpenMark size={28} />{t('empty.noChats')}</div>
          : <div className={css.list} aria-label={t('dashboard.title')}>
            {rows.map((node) => {
              const summary = list.byId[node.id]
              const cwd = summary?.cwd
              const statuses = sessionStatuses(node, t)
              return (
                <button
                  key={node.id}
                  type="button"
                  className={css.row}
                  onClick={() => { openSession(node.id) }}
                >
                  <StateDot state={statuses[0].state} className={css.dot} />
                  <span className={css.rowTitle}>{displayTitle(node, t)}</span>
                  <span className={css.rowMeta}>{cwd !== undefined && workspaceTitleOf(cwd) !== '' ? workspaceTitleOf(cwd) : t('dashboard.ungrouped')}</span>
                  <span className={css.rowTime}>{timeLabel(node, t)}</span>
                  {statuses.map(status => (
                    <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
                  ))}
                </button>
              )
            })}
          </div>}
      </div>
    </div>
  )
}
