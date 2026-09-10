// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@open-harness/oh-client-web-react'
import type { HeaderRootComponentProps } from '../src/client/contract/slots.ts'
import { HeaderRoot } from '../src/client/HeaderRoot.tsx'
import { en } from '../src/client/locales.ts'
import { createSidebarStore } from '../src/client/stores.ts'

// English-dictionary translate stub: the header renders the same copy the
// assertions below query by accessible name.
const t: HeaderRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function mountHeader({ tab = 'chats', currentSession }: {
  tab?: 'chats' | 'workspaces' | 'connectors'
  currentSession?: { current: unknown }
} = {}) {
  const startSession = vi.fn()
  const startChat = vi.fn()
  const setCenterView = vi.fn()
  const store = createSidebarStore().create()
  store.actions.setTab(tab)
  // An absent argument means "a session is current" (the realistic mount);
  // pass { current: undefined } for the session-less dashboard state.
  const sessionState = { current: currentSession === undefined ? 'session-1' : currentSession.current }
  const useSessions = ((sel: (s: typeof sessionState) => unknown) => sel(sessionState)) as never
  const useWorkspaces = (() => { throw new Error('header must not read useWorkspaces') }) as never
  // A fresh element per render: React bails out on a re-render with the same
  // element reference, so the re-render after mutating the mutable
  // sessionState closure needs a new object to take effect.
  const makeElement = () => (
    <HeaderRoot
      useSessions={useSessions} useWorkspaces={useWorkspaces}
      startSession={startSession} startChat={startChat} setCenterView={setCenterView}
      t={t}
      useStore={bindSnapshotSelector(store)} actions={store.actions}
    />
  )
  const view = render(makeElement())
  const result: typeof view & { rerender: () => void } = {
    ...view,
    rerender: () => { view.rerender(makeElement()) },
  }
  return { startSession, startChat, setCenterView, store, sessionState, ...result }
}

describe('HeaderRoot', () => {
  it('routes the brand to the active tab starter', () => {
    // The chats tab (the default): the brand is a "New chat" shortcut (the
    // ungrouped blank chat the Chats tab lists).
    const b = mountHeader()
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(b.startChat).toHaveBeenCalledOnce()
    expect(b.startSession).not.toHaveBeenCalled()
    cleanup()

    // Workspaces tab: the brand is a "New session" shortcut.
    const c = mountHeader({ tab: 'workspaces' })
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(c.startSession).toHaveBeenCalledOnce()
    expect(c.startChat).not.toHaveBeenCalled()
    cleanup()

    // The connectors tab: the brand is not a New shortcut — its label
    // switches to the browse-tabs a11y name and clicking it starts nothing
    // (the region's own "New connector" owns minting there).
    const d = mountHeader({ tab: 'connectors' })
    fireEvent.click(screen.getByRole('button', { name: 'Browse tabs' }))
    expect(d.startChat).not.toHaveBeenCalled()
    expect(d.startSession).not.toHaveBeenCalled()
    cleanup()
  })

  it('switches tabs through the tablist on the shared store', () => {
    const b = mountHeader()
    expect(screen.getByRole('tab', { name: 'Chats' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Workspaces' }).getAttribute('aria-selected')).toBe('false')

    fireEvent.click(screen.getByRole('tab', { name: 'Workspaces' }))
    expect(b.store.getSnapshot().tab).toBe('workspaces')
    expect(screen.getByRole('tab', { name: 'Workspaces' }).getAttribute('aria-selected')).toBe('true')

    // Clicking the active tab is a no-op.
    fireEvent.click(screen.getByRole('tab', { name: 'Workspaces' }))
    expect(b.store.getSnapshot().tab).toBe('workspaces')
    cleanup()
  })

  it('mirrors the browsing tab into the center view on navigation (no session current)', () => {
    const b = mountHeader({ currentSession: { current: undefined } })
    // A cold mount without a current session keeps the conversation hero —
    // the product's front door — so the tab effect writes nothing on mount
    // (the persisted tab still highlights in the header; the session-yield
    // effect owns the mount landing).
    expect(b.setCenterView).not.toHaveBeenCalled()

    // Each tab change writes twice: the click re-asserts immediately, the
    // effect confirms after the tab store settles.
    fireEvent.click(screen.getByRole('tab', { name: 'Connectors' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('connectors')
    expect(b.setCenterView).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('chats')
    expect(b.setCenterView).toHaveBeenCalledTimes(4)
    fireEvent.click(screen.getByRole('tab', { name: 'Workspaces' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('workspaces')
    expect(b.setCenterView).toHaveBeenCalledTimes(6)
    cleanup()

    // A cold mount never force-syncs the persisted tab, regardless of which
    // tab it is: the center lands on the conversation hero, not the tab's
    // dashboard.
    const c = mountHeader({ tab: 'chats', currentSession: { current: undefined } })
    expect(c.setCenterView).not.toHaveBeenCalled()
    cleanup()
    const d = mountHeader({ tab: 'connectors', currentSession: { current: undefined } })
    expect(d.setCenterView).not.toHaveBeenCalled()
  })

  it('yields a dashboard to the conversation when a session becomes current', () => {
    // Cold mount with a current session: the session sync lands the center on
    // the conversation (the tab effect is a no-op on mount, so this is the
    // only writer).
    const a = mountHeader({ tab: 'chats' })
    expect(a.setCenterView).toHaveBeenCalledTimes(1)
    expect(a.setCenterView).toHaveBeenLastCalledWith('conversation')
    cleanup()

    // No session yet, then one opens (row click, brand shortcut, or provider
    // chat): the center follows the session.
    const b = mountHeader({ tab: 'chats', currentSession: { current: undefined } })
    expect(b.setCenterView).not.toHaveBeenCalled()
    b.sessionState.current = 'session-2'
    b.rerender()
    expect(b.setCenterView).toHaveBeenLastCalledWith('conversation')
  })
})
