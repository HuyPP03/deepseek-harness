/**
 * Connectors surface plugin, browser half. One registration: ConnectorsRegion
 * fills the sidebar shell's `sidebar.connectors` hole (the connectors tab's
 * browsing region). The region reads the secret-free roster and drives the
 * token dialog through a controller owned by this apply closure; the renderer
 * binds the controller's snapshot store through the inject `hooks`
 * compartment. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectorsRegionInjected } from './contract/slots.ts'
import { ConnectorsSectionController } from './controller.ts'
import { ConnectorsRegion } from './ConnectorsRegion.tsx'
import { en, vi, zh, type ConnectorsKey } from './locales.ts'

export type { ConnectorsRegionInjected, ConnectorsRegionProps } from './contract/slots.ts'
export type { ConnectorsKey } from './locales.ts'
export type { ConnectTokenDialog, ConnectorsSectionState, RowOpError } from './controller.ts'
export { ConnectorsSectionController } from './controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The connectors region and token dialog copy. */
    connectors: ConnectorsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'connectors'

/**
 * Required services (cordis fiber inject): the slot registry the region
 * registers into, the locale registry for the copy, and the connection
 * service the controller reads the connector domain through.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the connectors region once the sidebar shell declares its hole.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, vi, zh }), 'ui-connectors: dictionaries')

  const controller = new ConnectorsSectionController((ctx.get('connection') as ConnectionHandle).api)
  const injected = (): ConnectorsRegionInjected => ({
    hooks: { connectors: controller.store },
    load: () => controller.load(),
    openTokenDialog: (id) => { controller.openTokenDialog(id) },
    setDialogDraft: (ref, value) => { controller.setDialogDraft(ref, value) },
    closeDialog: () => { controller.closeDialog() },
    saveToken: () => controller.saveToken(),
    connect: (id, mode) => controller.connect(id, mode),
    authorize: id => controller.authorize(id),
    disconnect: id => controller.disconnect(id),
  })
  ctx.slots.inject('sidebar.connectors', () => ctx.slots.register(
    {
      name: 'sidebar.connectors',
      locale: NS,
      inject: injected,
    },
    ConnectorsRegion,
  ))
}
