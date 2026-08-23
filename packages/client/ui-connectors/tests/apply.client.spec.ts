// @vitest-environment jsdom
/**
 * Registration: the region defers until the sidebar shell declares its
 * `sidebar.connectors` hole, rides the shell's declaration lifetime, and its
 * controller reads the connector domain through the connection service.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-connectors/client'
import type { ConnectorsRegionInjected } from '../src/client/contract/slots.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // The mutations answer the roster's one row back: the controller adopts
  // the response view, and the empty-roster case drops it.
  const row = {
    id: 'atlas', name: 'atlas', description: '', presetId: 'preset', state: 'connected',
    custom: false, servers: [], auth: [], suggestions: [],
  }
  const api = {
    connectors: {
      list: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connectors: [] } } })),
      configure: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connector: row } } })),
      connect: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connector: row } } })),
      complete: vi.fn(),
      disconnect: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connector: row } } })),
      add: vi.fn(),
      remove: vi.fn(),
    },
  }
  ctx.provide('connection', { api } as never)
  return { ctx, api }
}

/** The layout frame's entry: the 'sidebar' seat exists only under it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

/** The sidebar shell's own entry, declaring the connectors hole. */
function declareShell(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'sidebar',
    children: {
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.connectors': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-connectors apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('waits for the shell declaration, then registers the region', async () => {
    const { ctx } = await bench()
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply })
    // No declaration yet: nothing to fill.
    expect(slots.entries('sidebar.connectors')).toHaveLength(0)
    declareRoot(slots)
    declareShell(slots)
    await fiber.await()
    expect(slots.entries('sidebar.connectors')).toHaveLength(1)
    const entry = slots.entries('sidebar.connectors')[0]!
    expect(entry.locale).toBe('connectors')
    const injected = (entry.inject as unknown as () => ConnectorsRegionInjected)()
    expect(Object.keys(injected)).toEqual([
      'hooks', 'load', 'openTokenDialog', 'setDialogDraft', 'closeDialog', 'saveToken', 'connect', 'authorize', 'disconnect', 'selectProvider',
    ])
    // The hooks compartment carries the controller's snapshot store.
    const store = injected.hooks.connectors
    expect(typeof store.getSnapshot).toBe('function')
    expect(store.getSnapshot().status).toBe('loading')
    // The load callback reaches the connection service's connector domain.
    await injected.load()
    expect(store.getSnapshot().status).toBe('ready')
    // Every remaining callback forwards into the controller over the same
    // service; on the empty roster each one is a guard or a dropped view.
    injected.openTokenDialog('nope')
    expect(store.getSnapshot().dialog).toBeNull()
    injected.setDialogDraft('NOTION_API_TOKEN', 'sekrit')
    injected.closeDialog()
    await injected.saveToken()
    expect(store.getSnapshot().dialog).toBeNull()
    await injected.connect('nope', 'token')
    await injected.disconnect('nope')
    expect(store.getSnapshot().connectors).toEqual([])
    await fiber.dispose()
    expect(slots.entries('sidebar.connectors')).toHaveLength(0)
  })

  it('follows the declaration lifetime: a shell remount re-registers the region', async () => {
    const { ctx } = await bench()
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply })
    declareRoot(slots)
    const declare = declareShell(slots)
    await fiber.await()
    expect(slots.entries('sidebar.connectors')).toHaveLength(1)
    declare()
    expect(slots.entries('sidebar.connectors')).toHaveLength(0)
    declareShell(slots)
    await vi.waitFor(() => {
      expect(slots.entries('sidebar.connectors')).toHaveLength(1)
    })
    await fiber.dispose()
  })
})
