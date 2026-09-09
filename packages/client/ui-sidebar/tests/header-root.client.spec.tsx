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

// The header never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('header must not read global hooks') }) as never

function mountHeader({ tab = 'workspaces' }: {
  tab?: 'chats' | 'workspaces' | 'connectors'
} = {}) {
  const startSession = vi.fn()
  const startChat = vi.fn()
  const setCenterView = vi.fn()
  const store = createSidebarStore().create()
  store.actions.setTab(tab)
  const view = render(
    <HeaderRoot
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={startSession} startChat={startChat} setCenterView={setCenterView}
      t={t}
      useStore={bindSnapshotSelector(store)} actions={store.actions}
    />,
  )
  return { startSession, startChat, setCenterView, store, ...view }
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

  it('mirrors the browsing tab into the center view (connectors shows the directory)', () => {
    const b = mountHeader()
    // Mount syncs the persisted tab (workspaces) to the conversation view,
    // and exactly once — an unchanged tab issues no further writes.
    expect(b.setCenterView).toHaveBeenCalledTimes(1)
    expect(b.setCenterView).toHaveBeenCalledWith('conversation')

    // Each tab change writes twice: the click re-asserts immediately, the
    // effect confirms after the tab store settles.
    fireEvent.click(screen.getByRole('tab', { name: 'Connectors' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('connectors')
    expect(b.setCenterView).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('conversation')
    expect(b.setCenterView).toHaveBeenCalledTimes(5)
    cleanup()

    // A cold mount on the connectors tab syncs the directory view too.
    const c = mountHeader({ tab: 'connectors' })
    expect(c.setCenterView).toHaveBeenCalledWith('connectors')
  })
})
