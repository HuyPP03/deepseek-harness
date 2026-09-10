/** Sidebar shell + header slot registrations and their plain runtime/layout callbacks. */
import { Context } from '@open-harness/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@open-harness/oh-client-runtime/client'
import { LocaleRuntime } from '@open-harness/oh-client-locale/client'
import { apply, inject } from '@open-harness/oh-client-ui-sidebar/client'
import type { HeaderRootInjected, SidebarRootInjected } from '@open-harness/oh-client-ui-sidebar/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn(), setCenterView: vi.fn() }
  const workspaces = { startSession: vi.fn(), startChat: vi.fn(async () => 'chat-1') }
  const sessions = { open: vi.fn(), clear: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      {
        name: 'root',
        children: {
          'shell.header': { kind: 'single', scope: 'root' },
          'sidebar': { kind: 'single', scope: 'root' },
        },
      } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, workspaces, sessions }
}

describe('ui-sidebar apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'sessions', 'workspaces', 'locale'])
  })

  it('registers the shell and declares its child seats', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.workspaces')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.connectors')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('sidebar')[0]!.locale).toBe('sidebar')
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    expect(Object.keys(injected)).toEqual(['startSession', 'startChat', 'startConnector', 'toggleSidebar'])
    // Both arms delegate to the runtime's shared New Session action.
    injected.startSession('workspace' as never)
    expect(b.workspaces.startSession).toHaveBeenCalledWith('workspace')
    injected.startSession()
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith(undefined)
    // The chats arm resolves the chat session and opens it (a microtask
    // later: the arm is fire-and-forget on the injected face).
    injected.startChat()
    expect(b.workspaces.startChat).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith('chat-1')
    })
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('routes the Connectors New arm to the provided connectorNew command', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    // Not provided yet: the arm is a no-op (the command lands once the
    // connectors surface activates).
    injected.startConnector()
    const open = vi.fn()
    b.ctx.provide('connectorNew', { open } as never)
    injected.startConnector()
    expect(open).toHaveBeenCalledOnce()
  })

  it('registers the header (brand + navigation) on the shared tab store', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('shell.header')).toHaveLength(1)
    const header = b.slots.entries('shell.header')[0]!
    expect(header.locale).toBe('sidebar')
    // The header and the sidebar mount ONE shared store handle, so the tabs
    // and the context region can never drift apart.
    expect(header.store).toBe(b.slots.entries('sidebar')[0]!.store)
    const injected = (header.inject as () => HeaderRootInjected)()
    expect(Object.keys(injected)).toEqual(['startSession', 'startChat', 'setCenterView'])
    injected.startSession('workspace' as never)
    expect(b.workspaces.startSession).toHaveBeenCalledWith('workspace')
    injected.setCenterView('connectors')
    expect(b.layout.setCenterView).toHaveBeenCalledWith('connectors')
  })

  it('fails when no live owner declared the sidebar slot', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes the entry and child declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.entries('shell.header')).toHaveLength(0)
    expect(b.slots.spec('sidebar.workspaces')).toBeUndefined()
    expect(b.slots.spec('sidebar.footer.action')).toBeUndefined()
  })
})
