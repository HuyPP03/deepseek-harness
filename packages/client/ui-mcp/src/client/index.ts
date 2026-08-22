/**
 * MCP surface plugin, browser half — two surfaces over one roster: the MCP
 * settings section (live roster with reconnect and remove-for-user-servers,
 * plus the add form) and the /mcp DECORATION — the host command's bare
 * invocation becomes a roster popup. A row shows the server's status and
 * tool count; picking it gates behind a reconnect confirmation; the trailing
 * row deep links into the MCP settings section where a server is added.
 *
 * The host keeps the mcp command's catalog row, argument claim, and
 * lifecycle; the decoration replaces only what a bare pick would otherwise
 * do. add/remove go through the privileged wire calls; reconnect and list
 * are loopback-agnostic.
 */

import type { ConnectionHandle, McpServerRow } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the command surface contract (the /mcp decoration face).
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section'
// entry) and the panel controller's Context merge (ctx.settingsPanel).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { McpSection } from './McpSection.tsx'
import type { McpSectionInjected } from './McpSection.tsx'
import { McpSectionController } from './section-store.ts'
import { en, vi, zh, type McpKey } from './locales.ts'

export type { McpSectionInjected, McpSectionProps } from './McpSection.tsx'
export { McpSectionController, type AddDraft, type McpSectionState } from './section-store.ts'
export type { McpKey } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/** The settings-section registration id; the /mcp add row deep links to it. */
const SECTION_ID = 'mcp'

/** The /mcp popup's trailing add row; not a server name, so it cannot collide. */
const ADD_ROW_ID = '__add__'

/**
 * One row of the /mcp popup over one reported server.
 * @param row - the reported server.
 * @param t - the MCP namespace translate.
 * @returns the popup row with its reconnect confirmation gate.
 */
function serverRow(row: McpServerRow, t: (key: McpKey, params?: Record<string, unknown>) => string): {
  id: string
  label: string
  detail: string
  confirmation: {
    title: string
    description: string
    acknowledgeLabel: string
    cancelLabel: string
    confirmLabel: string
  }
} {
  const status = row.status === 'connecting' ? t('statusConnecting')
    : row.status === 'connected' ? t('statusConnected')
      : row.status === 'reconnecting' ? t('statusReconnecting')
        : t('statusDown')
  const tools = row.tools.length === 0 ? t('noTools')
    : row.tools.length === 1 ? t('toolsOne')
      : t('toolsMany', { count: row.tools.length })
  return {
    id: row.serverName,
    label: row.serverName,
    detail: `${status} · ${tools}`,
    confirmation: {
      title: t('reconnectTitle', { name: row.serverName }),
      description: t('reconnectDescription'),
      acknowledgeLabel: t('reconnectAcknowledge'),
      cancelLabel: t('reconnectCancel'),
      confirmLabel: t('reconnectConfirm'),
    },
  }
}

/**
 * Register the MCP dictionaries, the settings section, and the /mcp
 * decoration, each once its slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.mcp', { en, vi, zh }), 'ui-mcp: dictionaries')

  // The section controller owns the roster, the add form, the remove gate,
  // and the in-flight reconnect — one owner, one snapshot.
  const connection = ctx.get('connection') as ConnectionHandle
  const section = new McpSectionController(connection.api)
  const sectionInjected = (): McpSectionInjected => ({
    hooks: {
      mcpSection: section.store,
    },
    load: () => section.load(),
    beginAdd: () => { section.beginAdd() },
    cancelAdd: () => { section.cancelAdd() },
    setAddField: (field, value) => { section.setAddField(field, value) },
    submitAdd: () => section.submitAdd(),
    beginRemove: (name: string | null) => { section.beginRemove(name) },
    setRemoveAcknowledged: (acknowledged: boolean) => { section.setRemoveAcknowledged(acknowledged) },
    remove: () => section.remove(),
    reconnect: (name: string) => section.reconnect(name),
  })
  // After the existing feature sections: MCP servers are deployment-level
  // wiring, not per-session configuration.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 40,
    label: () => ctx.locale.bind('settings.mcp')('nav'),
    locale: 'settings.mcp',
    inject: sectionInjected,
  }, McpSection))

  // The /mcp decoration: a bare /mcp pick lists the reported servers with
  // their status and tools. A server row gates behind a reconnect
  // confirmation; the trailing row deep links into the MCP section to add.
  ctx.inject(['commandUi', 'connection', 'settingsPanel'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const t = ctx.locale.bind('settings.mcp')
    scope.effect(() => command.decorate({
      name: 'mcp',
      available: () => true,
      ui: {
        kind: 'popupSelect',
        options: async (_session, signal) => {
          const connection = scope.get('connection') as ConnectionHandle
          const response = await connection.api.mcp.list({}, signal)
          if (!response.result.ok) {
            throw new Error(`mcp.list failed: ${response.result.error.code}: ${response.result.error.message}`)
          }
          return [
            ...response.result.value.servers.map(row => serverRow(row, t)),
            {
              id: ADD_ROW_ID,
              label: t('add'),
              detail: t('addRowDetail'),
            },
          ]
        },
        onSelect: async (option, _session) => {
          if (option.id === ADD_ROW_ID) {
            scope.settingsPanel.openSection(SECTION_ID)
            return
          }
          const connection = scope.get('connection') as ConnectionHandle
          const response = await connection.api.mcp.reconnect({ serverName: option.id })
          if (!response.result.ok) {
            throw new Error(`mcp.reconnect failed: ${response.result.error.code}: ${response.result.error.message}`)
          }
        },
      },
    }), 'ui-mcp: /mcp decoration')
  })
}
