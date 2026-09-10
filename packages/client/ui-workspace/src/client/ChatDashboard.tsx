/**
 * Chats dashboard: the full-column center overlay behind the header's Chats
 * tab. Lists the recent ungrouped chats (the same row semantics as the
 * sidebar's Chats tab — deriveChats) newest-first, with the New chat call to
 * action. A card click opens the session; the header's session-open sync then
 * carries the center back to the conversation.
 */
import { useMemo } from 'react'
import { Button, IconChatDashboardHero18, IconPlusOutline16, OpenMark, StateDot } from '@open-harness/oh-client-ui-primitives'
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
      <div className={css.inner}>
        <div className={css.head}>
          <div className={css.headCopy}>
            <h1 className={css.title}>{t('dashboard.title')}</h1>
            <p className={css.lede}>{t('dashboard.subtitle')}</p>
          </div>
          <div className={css.headActions}>
            {rows.length > 0 && (
              <span className={css.count}>
                {t(rows.length === 1 ? 'dashboard.count.one' : 'dashboard.count.other', { n: rows.length })}
              </span>
            )}
            <Button variant="primary" onClick={() => { startChat() }} icon={<IconPlusOutline16 size={16} />}>
              {t('chat.new')}
            </Button>
          </div>
        </div>
        <div className={css.body}>
          {rows.length === 0
            ? (
              <div className={css.empty}>
                <span className={css.emptyIcon}><OpenMark size={28} /></span>
                <span className={css.emptyTitle}>{t('empty.noChats')}</span>
                <span className={css.emptyHint}>{t('empty.noChats.hint')}</span>
              </div>
            )
            : (
              <div className={css.grid} aria-label={t('dashboard.title')}>
                {rows.map((node) => {
                  const summary = list.byId[node.id]
                  const cwd = summary?.cwd
                  const statuses = sessionStatuses(node, t)
                  const workspace = cwd !== undefined && workspaceTitleOf(cwd) !== ''
                    ? workspaceTitleOf(cwd)
                    : t('dashboard.ungrouped')
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={css.card}
                      onClick={() => { openSession(node.id) }}
                    >
                      <span className={css.cardIcon}><IconChatDashboardHero18 size={18} /></span>
                      <span className={css.cardBody}>
                        <span className={css.cardTitleRow}>
                          <span className={css.cardTitle}>{displayTitle(node, t)}</span>
                          <StateDot state={statuses[0].state} className={css.dot} />
                        </span>
                        <span className={css.cardMeta}>
                          <span className={css.chip}>{workspace}</span>
                          <span className={css.cardTime}>{timeLabel(node, t)}</span>
                        </span>
                      </span>
                      {statuses.map(status => (
                        <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
                      ))}
                    </button>
                  )
                })}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
