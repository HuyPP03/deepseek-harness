// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@open-harness/oh-client-web-react'
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
      t={t}
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
  it('routes the New button to the active tab starter', () => {
    // Workspaces tab (the default): the button is "New session" and calls
    // startSession.
    const b = mountShell()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenCalledOnce()
    expect(b.startChat).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()

    cleanup()
    // The chats tab: the same button is "New chat" and calls startChat
    // (the ungrouped blank chat the Chats tab lists).
    const c = mountShell({ tab: 'chats' })
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(c.startChat).toHaveBeenCalledOnce()
    expect(c.startSession).not.toHaveBeenCalled()
    cleanup()

    // The connectors tab has no New control at all: its roster mints its own
    // connectors.
    mountShell({ tab: 'connectors' })
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
    cleanup()
  })

  it('renders the region for the shared tab (the nav tabs live in the header)', () => {
    const b = mountShell()
    expect(b.regionOwner().tab).toBe('workspaces')
    // No tablist in the sidebar: the header owns the navigation and both
    // occupants read the same store tab.
    expect(screen.queryAllByRole('tab')).toHaveLength(0)

    act(() => { b.store.actions.setTab('chats') })
    expect(b.regionOwner().tab).toBe('chats')
    cleanup()

    // The rail likewise has no tabs; its New icon follows the persisted tab
    // (the chats tab persists "New chat").
    mountShell({ collapsed: true, tab: 'chats' })
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy()
    cleanup()
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

    // Switching the shared tab back restores the workspaces region with the
    // tab handed over.
    act(() => { b.store.actions.setTab('chats') })
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
