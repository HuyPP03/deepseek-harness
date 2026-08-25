// @vitest-environment jsdom
/**
 * Registration: the two surfaces each defer until their host declares its
 * hole (the sidebar shell's `sidebar.connectors`, the frame's
 * `main.connectors`), ride the host declaration lifetime, and share one
 * controller reading the connector domain through the connection service.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-connectors/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectedProvidersListInjected, ConnectorsDirectoryInjected } from '../src/client/contract/slots.ts'

/** The roster's one row: the mutations answer it back and the list repeats it. */
const row = {
  id: 'atlas', name: 'atlas', description: '', presetId: 'preset', state: 'connected',
  custom: false, servers: [], auth: [], suggestions: [],
}
const ok = (value: unknown) => ({ rpcId: 'r', result: { ok: true as const, value } })

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const api = {
    connectors: {
      list: vi.fn(async () => ok({ connectors: [row] })),
      configure: vi.fn(async () => ok({ connector: row })),
      connect: vi.fn(async () => ok({ connector: row })),
      complete: vi.fn(),
      disconnect: vi.fn(async () => ok({ connector: row })),
      authorize: vi.fn(async () => ok({ authorizationUrl: 'http://127.0.0.1:8766/authorize', expiresAt: Date.now() + 300_000 })),
      deviceLogin: vi.fn(async () => ok({ status: 'ready' as const, expiresAt: Date.now() })),
      add: vi.fn(async () => ok({ id: 'custom' })),
      remove: vi.fn(async () => ok({})),
    },
  }
  ctx.provide('connection', { api } as never)
  const sessions = { open: vi.fn(), create: vi.fn(async () => 'new-id' as SessionId) }
  ctx.provide('sessions', sessions as never)
  const layout = { setCenterView: vi.fn() }
  ctx.provide('layout', layout as never)
  return { ctx, api, sessions, layout }
}

/** The layout frame's entry: the 'sidebar' and 'main.connectors' seats exist only under it. */
function declareFrame(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      'main.connectors': { kind: 'single', scope: 'root' },
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
    expect(inject).toEqual(['slots', 'locale', 'connection', 'sessions', 'layout'])
  })

  it('waits for the host declarations, then registers both surfaces over one controller', async () => {
    const { ctx, sessions, layout } = await bench()
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply })
    // No declaration yet: nothing to fill.
    expect(slots.entries('sidebar.connectors')).toHaveLength(0)
    expect(slots.entries('main.connectors')).toHaveLength(0)
    declareFrame(slots)
    await fiber.await()
    // The frame alone declares the directory hole; the list waits for the shell.
    expect(slots.entries('main.connectors')).toHaveLength(1)
    expect(slots.entries('sidebar.connectors')).toHaveLength(0)
    declareShell(slots)
    await vi.waitFor(() => {
      expect(slots.entries('sidebar.connectors')).toHaveLength(1)
    })
    const listEntry = slots.entries('sidebar.connectors')[0]!
    const directoryEntry = slots.entries('main.connectors')[0]!
    expect(listEntry.locale).toBe('connectors')
    expect(directoryEntry.locale).toBe('connectors')
    // The list face is the selection subset; the directory face is the full
    // callback set.
    const listInjected = (listEntry.inject as unknown as () => ConnectedProvidersListInjected)()
    expect(Object.keys(listInjected)).toEqual(['hooks', 'load', 'selectProvider'])
    const directoryInjected = (directoryEntry.inject as unknown as () => ConnectorsDirectoryInjected)()
    expect(Object.keys(directoryInjected)).toEqual([
      'hooks', 'load', 'openTokenDialog', 'setDialogDraft', 'closeDialog', 'saveToken', 'openOauthDialog', 'setOauthDraft', 'closeOauthDialog', 'saveOauth', 'connect', 'authorize', 'deviceLogin', 'disconnect', 'selectProvider', 'openCustomDialog', 'setCustomDraft', 'closeCustomDialog', 'saveCustom', 'removeCustom', 'openSession', 'newProviderChat',
    ])
    // Both faces bind the same controller store: one controller, two surfaces.
    const listStore = listInjected.hooks.connectors
    const directoryStore = directoryInjected.hooks.connectors
    expect(directoryStore).toBe(listStore)
    expect(typeof listStore.getSnapshot).toBe('function')
    expect(listStore.getSnapshot().status).toBe('loading')
    // Both surfaces read through the same single-flighted controller: the
    // directory's load reaches the connection service's connector domain.
    await directoryInjected.load()
    expect(directoryStore.getSnapshot().status).toBe('ready')
    await listInjected.load()
    // The list's selectProvider and the directory's share one selection.
    listInjected.selectProvider('atlas')
    expect(directoryStore.getSnapshot().selectedProvider).toBe('atlas')
    directoryInjected.selectProvider(null)
    expect(directoryStore.getSnapshot().selectedProvider).toBeNull()
    // The provider session wiring rides the directory face: opening a
    // session and minting one under the provider's preset reach the session
    // service.
    // Opening a provider chat leaves the overlay: the center view returns
    // to the conversation in the same step as the session open.
    directoryInjected.openSession('atlas' as SessionId)
    expect(sessions.open).toHaveBeenCalledWith('atlas')
    expect(layout.setCenterView).toHaveBeenCalledWith('conversation')
    await directoryInjected.newProviderChat('atlas')
    expect(sessions.create).toHaveBeenCalledWith({ agentPreset: 'preset' })
    expect(sessions.open).toHaveBeenCalledWith('new-id')
    expect(layout.setCenterView).toHaveBeenLastCalledWith('conversation')
    // A provider with no roster row has no preset: New chat is a no-op and
    // leaves the center view alone.
    await directoryInjected.newProviderChat('nope')
    expect(sessions.create).toHaveBeenCalledOnce()
    expect(layout.setCenterView).toHaveBeenCalledTimes(2)
    // Every remaining directory callback forwards into the controller over
    // the same service; on the roster each is a guard, a flow, or a
    // mutation the controller adopts.
    directoryInjected.openTokenDialog('nope')
    expect(directoryStore.getSnapshot().dialog).toBeNull()
    directoryInjected.setDialogDraft('NOTION_API_TOKEN', 'sekrit')
    directoryInjected.closeDialog()
    await directoryInjected.saveToken()
    expect(directoryStore.getSnapshot().dialog).toBeNull()
    // The OAuth app (byoApp) dialog callbacks forward into the controller
    // the same way; the roster has no unconfigured byoApp method, so each
    // is a guard here.
    directoryInjected.openOauthDialog('nope')
    expect(directoryStore.getSnapshot().oauthDialog).toBeNull()
    directoryInjected.setOauthDraft('clientId', 'orphan')
    directoryInjected.closeOauthDialog()
    await directoryInjected.saveOauth()
    expect(directoryStore.getSnapshot().oauthDialog).toBeNull()
    await directoryInjected.connect('nope', 'token')
    await directoryInjected.disconnect('nope')
    // The browser flow callbacks reach the wire and surface their results.
    await expect(directoryInjected.authorize('nope')).resolves.toMatchObject({ authorizationUrl: 'http://127.0.0.1:8766/authorize' })
    await expect(directoryInjected.deviceLogin('nope')).resolves.toMatchObject({ status: 'ready' })
    // The custom-dialog draft round-trips through the controller store.
    directoryInjected.openCustomDialog()
    expect(directoryStore.getSnapshot().customDialog).not.toBeNull()
    directoryInjected.setCustomDraft('name', 'Bench Svc')
    expect(directoryStore.getSnapshot().customDialog?.drafts.name).toBe('Bench Svc')
    directoryInjected.closeCustomDialog()
    expect(directoryStore.getSnapshot().customDialog).toBeNull()
    // add and remove re-list the roster through the single-flighted read.
    await directoryInjected.saveCustom()
    expect(directoryStore.getSnapshot().customDialog).toBeNull()
    await directoryInjected.removeCustom('atlas')
    // The mutation answers with the single row the controller adopts.
    expect(directoryStore.getSnapshot().connectors.map(c => c.id)).toEqual(['atlas'])
    await fiber.dispose()
    expect(slots.entries('sidebar.connectors')).toHaveLength(0)
    expect(slots.entries('main.connectors')).toHaveLength(0)
  })

  it('publishes the loaded roster preset ids under connectorPresetIds for the Chats tab', async () => {
    const { ctx, api } = await bench()
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply })
    declareFrame(slots)
    declareShell(slots)
    await fiber.await()
    // The service is up before the first roster read: an empty set.
    const presetIds = ctx.get('connectorPresetIds') as { getSnapshot: () => ReadonlySet<string> }
    expect([...presetIds.getSnapshot()]).toEqual([])
    const directoryEntry = slots.entries('main.connectors')[0]!
    const directoryInjected = (directoryEntry.inject as unknown as () => ConnectorsDirectoryInjected)()
    await directoryInjected.load()
    // The loaded roster's preset ids reach the set.
    expect([...presetIds.getSnapshot()]).toEqual(['preset'])
    // A re-list that keeps the id set intact does not republish the snapshot.
    const before = presetIds.getSnapshot()
    await directoryInjected.load()
    expect(presetIds.getSnapshot()).toBe(before)
    // A re-list with a new connector republishes the grown set.
    vi.mocked(api.connectors.list).mockResolvedValueOnce(ok({
      connectors: [row, { ...row, id: 'beta', presetId: 'preset-beta' }],
    }))
    await directoryInjected.load()
    expect([...presetIds.getSnapshot()]).toEqual(['preset', 'preset-beta'])
    await fiber.dispose()
    // Disposal removes the service with the fiber.
    expect(ctx.get('connectorPresetIds')).toBeUndefined()
  })

  it('follows the shell declaration lifetime: a shell remount re-registers the list', async () => {
    const { ctx } = await bench()
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply })
    declareFrame(slots)
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
