/**
 * Workspaces dashboard: the full-column center overlay behind the header's
 * Workspaces tab. A card grid over every real Workspace — label, folder
 * path, session count, and the newest activity — where a card click opens
 * the workspace's newest session, or starts one when it holds none.
 */
import { useMemo } from 'react'
import { IconFolderClose16, OpenMark } from '@open-harness/oh-client-ui-primitives'
import type { WorkspaceDashboardProps } from './contract/slots.ts'
import type { SessionNode } from './tree.ts'
import { deriveGroups, relativeTime } from './tree.ts'
import css from './WorkspaceDashboard.module.css'

/** The newest session of a card, or undefined for a session-less one. */
function newestSession(sessions: readonly SessionNode[]): SessionNode | undefined {
  let newest: SessionNode | undefined
  for (const session of sessions) {
    if (newest === undefined || session.updatedAt > newest.updatedAt) newest = session
  }
  return newest
}

/**
 * Render the workspaces dashboard.
 * @param props - composed slot props (global seats + injected actions + locale seat).
 * @returns the dashboard element tree.
 */
export function WorkspaceDashboard({
  t,
  useSessions,
  useWorkspaces,
  openSession,
  startSession,
}: WorkspaceDashboardProps) {
  const list = useSessions(s => s)
  const workspaces = useWorkspaces(w => w)
  // Every group expanded so the derivation fills each card's session rows
  // (the card reads only its count and newest, never the whole list).
  const groups = useMemo(
    () => deriveGroups(list, workspaces.items, workspaces.archivedSessionIds, {
      expandedGroups: workspaces.items.map(w => w.workspaceId as string),
    }),
    [list, workspaces.items, workspaces.archivedSessionIds],
  )
  return (
    <div className={css.dash}>
      <div className={css.head}>
        <h1 className={css.title}>{t('section.workspaces')}</h1>
        {groups.length > 0 && (
          <span className={css.count}>
            {t(groups.length === 1 ? 'workspaces.count.one' : 'workspaces.count.other', { n: groups.length })}
          </span>
        )}
      </div>
      <div className={css.gridScroll}>
        {groups.length === 0
          ? <div className={css.empty}><OpenMark size={28} />{t('empty.noWorkspaces')}</div>
          : <div className={css.grid} aria-label={t('section.workspaces')}>
            {groups.map((group) => {
              const newest = newestSession(group.sessions)
              // The card opens the NEWEST non-blank session (a blank row is the
              // provisional New Session, not an openable conversation).
              const openable = newestSession(group.sessions.filter(s => !s.blank))
              return (
                <button
                  key={group.key}
                  type="button"
                  className={css.card}
                  onClick={() => {
                    if (openable !== undefined) openSession(openable.id)
                    else startSession(group.workspaceId)
                  }}
                >
                  <span className={css.cardIcon}><IconFolderClose16 size={20} /></span>
                  <span className={css.cardBody}>
                    <span className={css.cardTitle}>{group.label}</span>
                    <span className={css.cardPath}>{group.cwd}</span>
                    <span className={css.cardMeta}>
                      {t(group.sessionCount === 1 ? 'sessions.count.one' : 'sessions.count.other', { n: group.sessionCount })}
                    </span>
                  </span>
                  {newest !== undefined && (
                    <span className={css.cardTime}>{relativeTimeLabel(newest.updatedAt, t)}</span>
                  )}
                </button>
              )
            })}
          </div>}
      </div>
    </div>
  )
}

/** Localized compact relative time (e.g. `now` / `5 min` in en). */
function relativeTimeLabel(updatedAt: number, t: WorkspaceDashboardProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, Date.now())
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}
