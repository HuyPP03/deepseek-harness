/**
 * Connectors surface plugin, browser half. Two registrations over one
 * controller: ConnectedProvidersList fills the sidebar shell's
 * `sidebar.connectors` hole (the compact list of already-connected providers),
 * and ConnectorsDirectory fills the frame's `main.connectors` hole (the
 * full-column browse grid with the risk notes and the selected provider's
 * detail). Both read the secret-free roster and drive the token and custom
 * dialogs through the controller owned by this apply closure; the renderer
 * binds the controller's snapshot store through the inject `hooks`
 * compartment. Export discipline: packages/client/AGENTS.md.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the layout plugin's Context merge (ctx.layout), so a
// provider chat opened from the directory can dismiss the overlay.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConnectedProvidersListInjected, ConnectorsDirectoryInjected } from './contract/slots.ts'
import { ConnectorsSectionController } from './controller.ts'
import { ConnectedProvidersList } from './ConnectedProvidersList.tsx'
import { ConnectorsDirectory } from './ConnectorsDirectory.tsx'
import { en, vi, zh, type ConnectorsKey } from './locales.ts'

export type {
  ConnectedProvidersListInjected, ConnectedProvidersListProps,
  ConnectorsDirectoryCallbacks, ConnectorsDirectoryInjected, ConnectorsDirectoryProps, ConnectorsTranslate,
} from './contract/slots.ts'
export type { ConnectorsKey } from './locales.ts'
export type { ConnectTokenDialog, ConnectorsSectionState, RowOpError } from './controller.ts'
export { ConnectorsSectionController } from './controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The connectors directory, list, and dialog copy. */
    connectors: ConnectorsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'connectors'

/**
 * Required services (cordis fiber inject): the slot registry both surfaces
 * register into, the locale registry for the copy, the connection service
 * the controller reads the connector domain through, the session service
 * the provider detail opens and mints chats through, and the layout service
 * whose center view a session open has to switch back to the conversation.
 */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'layout']

/**
 * Register both connectors surfaces once their hosts declare the holes.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, vi, zh }), 'ui-connectors: dictionaries')

  const controller = new ConnectorsSectionController((ctx.get('connection') as ConnectionHandle).api)

  // The preset ids of every connector as a bare observable: the Chats tab
  // (ui-workspace) reads it to keep provider chats out of its own list —
  // provider detail is their only home. The roster read is the single source
  // of truth for the set; the source republishes only when the set itself
  // moves, so an unchanged roster costs the consumer a no-op snapshot.
  const presetStore = createSnapshotStore<ReadonlySet<string>>(new Set())
  ctx.provide('connectorPresetIds', presetStore)
  ctx.effect(() => {
    const sync = (): void => {
      const next = new Set(controller.store.getSnapshot().connectors.map(c => c.presetId))
      const prev = presetStore.getSnapshot()
      if (prev.size !== next.size || [...next].some(id => !prev.has(id))) presetStore.set(next)
    }
    sync()
    return controller.store.subscribe(sync)
  }, 'ui-connectors: connectorPresetIds')

  const injected = (): ConnectorsDirectoryInjected => ({
    hooks: { connectors: controller.store },
    load: () => controller.load(),
    openTokenDialog: (id) => { controller.openTokenDialog(id) },
    setDialogDraft: (ref, value) => { controller.setDialogDraft(ref, value) },
    closeDialog: () => { controller.closeDialog() },
    saveToken: () => controller.saveToken(),
    openOauthDialog: (id) => { controller.openOauthDialog(id) },
    setOauthDraft: (field, value) => { controller.setOauthDraft(field, value) },
    closeOauthDialog: () => { controller.closeOauthDialog() },
    saveOauth: () => controller.saveOauth(),
    connect: (id, mode) => controller.connect(id, mode),
    authorize: id => controller.authorize(id),
    deviceLogin: id => controller.deviceLogin(id),
    disconnect: id => controller.disconnect(id),
    selectProvider: (id) => { controller.selectProvider(id) },
    openCustomDialog: () => { controller.openCustomDialog() },
    setCustomDraft: (field, value) => { controller.setCustomDraft(field, value) },
    closeCustomDialog: () => { controller.closeCustomDialog() },
    saveCustom: () => controller.saveCustom(),
    removeCustom: id => controller.removeCustom(id),
    // Opening a chat from the directory must leave the overlay: the session
    // opens in the conversation column underneath, so the center view returns
    // to the conversation in the same step.
    openSession: (id) => {
      ctx.sessions.open(id)
      ctx.layout.setCenterView('conversation')
    },
    newProviderChat: async (providerId: string) => {
      const presetId = controller.providerPresetId(providerId)
      if (presetId === undefined) return
      const id = await ctx.sessions.create({ agentPreset: presetId })
      ctx.sessions.open(id)
      ctx.layout.setCenterView('conversation')
    },
  })
  const listInjected = (): ConnectedProvidersListInjected => ({
    hooks: { connectors: controller.store },
    load: () => controller.load(),
    selectProvider: (id) => { controller.selectProvider(id) },
  })
  ctx.slots.inject('sidebar.connectors', () => ctx.slots.register(
    {
      name: 'sidebar.connectors',
      locale: NS,
      inject: listInjected,
    },
    ConnectedProvidersList,
  ))
  ctx.slots.inject('main.connectors', () => ctx.slots.register(
    {
      name: 'main.connectors',
      locale: NS,
      inject: injected,
    },
    ConnectorsDirectory,
  ))
}
