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

function mountHeader({ tab = 'workspaces', currentSession }: {
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
    // Workspaces tab (the default): the brand is a "New session" shortcut.
    const b = mountHeader()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenCalledOnce()
    expect(b.startChat).not.toHaveBeenCalled()
    cleanup()

    // The chats tab: the brand is a "New chat" shortcut (the ungrouped blank
    // chat the Chats tab lists).
    const c = mountHeader({ tab: 'chats' })
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(c.startChat).toHaveBeenCalledOnce()
    expect(c.startSession).not.toHaveBeenCalled()
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
    expect(screen.getByRole('tab', { name: 'Workspaces' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Chats' }).getAttribute('aria-selected')).toBe('false')

    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.store.getSnapshot().tab).toBe('chats')
    expect(screen.getByRole('tab', { name: 'Chats' }).getAttribute('aria-selected')).toBe('true')

    // Clicking the active tab is a no-op.
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.store.getSnapshot().tab).toBe('chats')
    cleanup()
  })

  it('mirrors the browsing tab into the center view (no session current)', () => {
    const b = mountHeader({ currentSession: { current: undefined } })
    // Mount syncs the persisted tab (workspaces) to the workspace dashboard,
    // and exactly once — an unchanged tab issues no further writes.
    expect(b.setCenterView).toHaveBeenCalledTimes(1)
    expect(b.setCenterView).toHaveBeenCalledWith('workspaces')

    // Each tab change writes twice: the click re-asserts immediately, the
    // effect confirms after the tab store settles.
    fireEvent.click(screen.getByRole('tab', { name: 'Connectors' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('connectors')
    expect(b.setCenterView).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('chats')
    expect(b.setCenterView).toHaveBeenCalledTimes(5)
    fireEvent.click(screen.getByRole('tab', { name: 'Workspaces' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('workspaces')
    expect(b.setCenterView).toHaveBeenCalledTimes(7)
    cleanup()

    // Cold mounts sync the persisted tab too: Chats its dashboard, Connectors
    // the directory.
    const c = mountHeader({ tab: 'chats', currentSession: { current: undefined } })
    expect(c.setCenterView).toHaveBeenCalledWith('chats')
    cleanup()
    const d = mountHeader({ tab: 'connectors', currentSession: { current: undefined } })
    expect(d.setCenterView).toHaveBeenCalledWith('connectors')
  })

  it('yields a dashboard to the conversation when a session becomes current', () => {
    // Cold mount on Chats with a current session: the session sync (declared
    // after the tab sync) lands the center on the conversation.
    const a = mountHeader({ tab: 'chats' })
    expect(a.setCenterView).toHaveBeenLastCalledWith('conversation')
    cleanup()

    // The dashboard showing, then a session opens (row click, brand shortcut,
    // or provider chat): the center follows the session.
    const b = mountHeader({ tab: 'chats', currentSession: { current: undefined } })
    expect(b.setCenterView).toHaveBeenLastCalledWith('chats')
    b.sessionState.current = 'session-2'
    b.rerender()
    expect(b.setCenterView).toHaveBeenLastCalledWith('conversation')
  })
})
