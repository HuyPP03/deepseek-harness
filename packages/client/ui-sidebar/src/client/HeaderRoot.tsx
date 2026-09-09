/**
 * Header shell: the full-width top bar — the product brand and the primary
 * navigation (Chats / Workspaces / Connectors). The tabs share the sidebar
 * store's browsing tab, so the header and the sidebar's context region never
 * disagree; the header owns the tab -> center-view mirror, and the sidebar
 * renders its region against the same tab read-only.
 */
import { useEffect } from 'react'
import clsx from 'clsx'
import { OpenMark } from '@open-harness/oh-client-ui-primitives'
import type { CenterView } from '@open-harness/oh-client-ui-layout/client'
import type { HeaderRootComponentProps } from './contract/slots.ts'
import css from './HeaderRoot.module.css'

/**
 * The center view each browsing tab shows: Chats and Workspaces their
 * dashboards, Connectors the directory overlay.
 */
function viewForTab(tab: 'chats' | 'workspaces' | 'connectors'): CenterView {
  if (tab === 'connectors') return 'connectors'
  if (tab === 'chats') return 'chats'
  return 'workspaces'
}

/**
 * Render the header bar (brand + primary navigation).
 * @param props - composed slot props (store + injected callbacks + locale seat, contract/slots.ts).
 * @returns the header element tree.
 */
export function HeaderRoot({
  startSession,
  startChat,
  setCenterView,
  t,
  useStore,
  useSessions,
  actions,
}: HeaderRootComponentProps) {
  const tab = useStore(state => state.tab)
  const currentSession = useSessions(state => state.current)
  // The browsing tab drives the center column's full-column view: Chats its
  // dashboard, Connectors the directory overlay, Workspaces the conversation.
  // An effect (not the click handler) so the persisted tab restored on mount
  // syncs too.
  useEffect(() => {
    setCenterView(viewForTab(tab))
  }, [tab, setCenterView])
  // Opening a session yields any dashboard to the conversation (the row
  // click, the brand shortcut, or a provider chat from the directory); the
  // declared last so a mount with a current session lands on it.
  useEffect(() => {
    if (currentSession !== undefined) setCenterView('conversation')
  }, [currentSession, setCenterView])
  // A tab click re-asserts the center view even when the tab is already
  // active: opening a session from the dashboard switches the center view
  // back to the conversation while the tab stays on Chats, so the next click
  // on that tab must bring the dashboard back.
  const selectTab = (candidate: 'chats' | 'workspaces' | 'connectors'): void => {
    if (tab !== candidate) actions.setTab(candidate)
    setCenterView(viewForTab(candidate))
  }
  // The brand doubles as a New shortcut for the active tab: Chats mints the
  // ungrouped blank chat, Workspaces starts a session. The connectors tab
  // has no New control: the region's own "New connector" mints its entries.
  const startNew = tab === 'workspaces' ? () => { startSession() } : startChat
  const newLabelFull = tab === 'workspaces' ? t('session.new.label') : t('chat.new.label')
  return (
    <div className={css.header}>
      <button
        type="button"
        className={css.brand}
        aria-label={tab === 'connectors' ? t('tabs.label') : newLabelFull}
        onClick={() => { if (tab !== 'connectors') startNew() }}
      >
        <OpenMark size={20} />
        <span className={css.brandText}>Open Harness</span>
      </button>
      <div className={css.tabs} role="tablist" aria-label={t('tabs.label')}>
        {(['chats', 'workspaces', 'connectors'] as const).map(candidate => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            className={clsx(css.tab, tab === candidate && css.tabActive)}
            onClick={() => { selectTab(candidate) }}
          >
            {t(`tab.${candidate}` as const)}
          </button>
        ))}
      </div>
    </div>
  )
}
