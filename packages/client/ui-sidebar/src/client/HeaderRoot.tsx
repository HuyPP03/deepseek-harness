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
import type { HeaderRootComponentProps } from './contract/slots.ts'
import css from './HeaderRoot.module.css'

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
  actions,
}: HeaderRootComponentProps) {
  const tab = useStore(state => state.tab)
  // The browsing tab drives the center column's full-column view: the
  // connectors tab shows the directory overlay over the conversation, the
  // other tabs the conversation. An effect (not the click handler) so the
  // persisted tab restored on mount syncs too.
  useEffect(() => {
    setCenterView(tab === 'connectors' ? 'connectors' : 'conversation')
  }, [tab, setCenterView])
  // A tab click re-asserts the center view even when the tab is already
  // active: opening a provider chat from the directory switches the center
  // view back to the conversation while the tab stays on connectors, so the
  // next click on that tab must bring the directory back.
  const selectTab = (candidate: 'chats' | 'workspaces' | 'connectors'): void => {
    if (tab !== candidate) actions.setTab(candidate)
    setCenterView(candidate === 'connectors' ? 'connectors' : 'conversation')
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
