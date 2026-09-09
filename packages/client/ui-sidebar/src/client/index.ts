/**
 * Registers the sidebar shell and the header bar (brand + primary
 * navigation) into the layout-owned slots; both share the browsing-tab
 * store.
 */
import type { ClientContext, WorkspaceId } from '@open-harness/oh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@open-harness/oh-client-locale/client'
import type { HeaderRootInjected, SidebarRootInjected } from './contract/slots.ts'
import { HeaderRoot } from './HeaderRoot.tsx'
import { SidebarRoot } from './SidebarRoot.tsx'
import { createSidebarStore } from './stores.ts'
import { en, vi, zh, type SidebarKey } from './locales.ts'

export type {
  HeaderRootComponentProps, HeaderRootInjected,
  SidebarConnectorsOwnerProps, SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarRootInjected,
  SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@open-harness/oh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar shell controls copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebar'

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'locale']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, vi, zh }), 'ui-sidebar: dictionaries')

  // The brand New shortcut rides the runtime's shared actions: the session
  // form reuses-or-creates the current Session Workspace (then the recent
  // Workspace), the chat form reuses-or-mints the ungrouped blank chat.
  const startSession = (workspaceId: WorkspaceId | undefined): void => { ctx.workspaces.startSession(workspaceId) }
  const startChat = (): void => { void ctx.workspaces.startChat().then((id) => { ctx.sessions.open(id) }) }
  // One browsing-tab store shared by both occupants: header tabs and the
  // sidebar's context region read the same tab, so they never disagree.
  const store = createSidebarStore()
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      store,
      // The shell owns geometry; ui-workspace registers the whole browsing
      // region (header, search, session list, workspace dialogs), ui-settings
      // registers the foot trigger + settings panel.
      children: {
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.connectors': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: (): SidebarRootInjected => ({
        startSession,
        startChat,
        toggleSidebar: () => { ctx.layout.toggleSidebar() },
      }),
    }, SidebarRoot),
    'ui-sidebar: slot registration',
  )
  ctx.effect(
    () => ctx.slots.register({
      name: 'shell.header',
      locale: NS,
      store,
      inject: (): HeaderRootInjected => ({
        startSession,
        startChat,
        // The header mirrors its active browsing tab into the layout's center
        // view (the connectors tab shows the directory overlay over the
        // center column; the frame renders against the store value).
        setCenterView: (view) => { ctx.layout.setCenterView(view) },
      }),
    }, HeaderRoot),
    'ui-sidebar: header registration',
  )
}
