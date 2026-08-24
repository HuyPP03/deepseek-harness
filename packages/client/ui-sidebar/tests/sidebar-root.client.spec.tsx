// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type {
  SidebarConnectorsOwnerProps, SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'
import { createSidebarStore } from '../src/client/stores.ts'

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: SidebarRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never

function mountShell({ collapsed = false, width = 300, tab = 'workspaces' }: {
  collapsed?: boolean
  width?: number
  tab?: 'chats' | 'workspaces' | 'connectors'
} = {}) {
  const startSession = vi.fn()
  const startChat = vi.fn()
  const toggleSidebar = vi.fn()
  const setCenterView = vi.fn()
  const store = createSidebarStore().create()
  store.actions.setTab(tab)
  let regionOwner: SidebarSectionOwnerProps | undefined
  let connectorsOwner: SidebarConnectorsOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  let current = { collapsed, width }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={startSession} startChat={startChat} toggleSidebar={toggleSidebar}
      setCenterView={setCenterView} t={t}
      useStore={bindSnapshotSelector(store)} actions={store.actions}
      renderSlot={((
        key: string,
        owner: SidebarConnectorsOwnerProps | SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.connectors') {
          // The union collapses to the widest member; the cast names the
          // branch's actual owner (the stub's parameter is a union stand-in).
          connectorsOwner = owner as SidebarConnectorsOwnerProps
          return <div data-testid="connectors-region" data-wide={owner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={owner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    startChat,
    store,
    toggleSidebar,
    setCenterView,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    connectorsOwner: () => {
      if (connectorsOwner === undefined) throw new Error('connectors owner not rendered')
      return connectorsOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('SidebarRoot shell', () => {
  it('routes New (capsule + wordmark) to the active tab starter', () => {
    // Workspaces tab (the default): both starters call startSession.
    const b = mountShell()
    const starters = screen.getAllByRole('button', { name: 'New session' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    expect(b.startChat).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()

    cleanup()
    // The chats tab: the same two starters are "New chat" and call startChat
    // (the ungrouped blank chat the Chats tab lists).
    const c = mountShell({ tab: 'chats' })
    const chatStarters = screen.getAllByRole('button', { name: 'New chat' })
    expect(chatStarters).toHaveLength(2)
    for (const button of chatStarters) fireEvent.click(button)
    expect(c.startChat).toHaveBeenCalledTimes(2)
    expect(c.startSession).not.toHaveBeenCalled()
    cleanup()
  })

  it('switches tabs through the tablist and hands the tab to the region', () => {
    const b = mountShell()
    expect(b.regionOwner().tab).toBe('workspaces')
    expect(screen.getByRole('tab', { name: 'Workspaces' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Chats' }).getAttribute('aria-selected')).toBe('false')

    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.store.getSnapshot().tab).toBe('chats')
    expect(b.regionOwner().tab).toBe('chats')
    expect(screen.getByRole('tab', { name: 'Chats' }).getAttribute('aria-selected')).toBe('true')

    // Clicking the active tab is a no-op.
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.store.getSnapshot().tab).toBe('chats')
    cleanup()

    // The rail has no tablist; the New icon follows the persisted tab (the
    // chats tab persists "New chat").
    mountShell({ collapsed: true, tab: 'chats' })
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy()
    cleanup()
  })

  it('mirrors the browsing tab into the center view (connectors shows the directory)', () => {
    const b = mountShell()
    // Mount syncs the persisted tab (workspaces) to the conversation view,
    // and exactly once — an unchanged tab issues no further writes.
    expect(b.setCenterView).toHaveBeenCalledTimes(1)
    expect(b.setCenterView).toHaveBeenCalledWith('conversation')

    fireEvent.click(screen.getByRole('tab', { name: 'Connectors' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('connectors')
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(b.setCenterView).toHaveBeenLastCalledWith('conversation')
    expect(b.setCenterView).toHaveBeenCalledTimes(3)
    cleanup()

    // A cold mount on the connectors tab syncs the directory view too.
    const c = mountShell({ tab: 'connectors' })
    expect(c.setCenterView).toHaveBeenCalledWith('connectors')
  })

  it('swaps the browsing region for the connectors registrant on the connectors tab', () => {
    const b = mountShell({ tab: 'connectors' })
    // The workspaces region is not rendered at all; the connectors owner
    // carries the column state but no tab (the shell renders it on one tab).
    expect(screen.queryByTestId('region')).toBeNull()
    expect(screen.getByTestId('connectors-region')).toBeTruthy()
    const owner = b.connectorsOwner()
    expect(owner.wide).toBe(true)
    expect('tab' in owner).toBe(false)
    owner.expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()

    // The connectors tab has no New control: its roster mints its own
    // connectors, and a blank session has nothing to do with the roster.
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull()

    // Switching back restores the workspaces region with the tab handed over.
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(screen.getByTestId('region')).toBeTruthy()
    expect(screen.queryByTestId('connectors-region')).toBeNull()
    expect(b.regionOwner().tab).toBe('chats')
  })

  it('expands on the connectors region request when the column is collapsed', () => {
    const b = mountShell({ tab: 'connectors', collapsed: true })
    expect(b.connectorsOwner().wide).toBe(false)
    b.connectorsOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('hands the region its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    vi.useFakeTimers()
    const b = mountShell()
    b.rerender({ collapsed: true })
    // Wide content survives the crossfade window, then settles into the rail.
    expect(b.regionOwner().wide).toBe(true)
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(b.regionOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByTestId('region')).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders statically collapsed on a cold start (no crossfade classes)', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })
})
