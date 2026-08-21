/**
 * Slash tools plugin, browser half: client-owned slash entries whose behavior
 * lives entirely on the client. Two surfaces: the /clear ACTION — a menu pick
 * or a bare enter starts a fresh blank session in the current session's
 * workspace (and preset, when the deployment composes one) and opens it; and
 * the /help popupSelect — the session's available slash commands listed from
 * the merged menu face, informational (picking a row closes the popup).
 *
 * The current session stays in the list untouched on /clear; its references
 * do not carry over (the list summary carries no reference axis, so the
 * action cannot see them). The /clear action kind has no result channel:
 * create or open failures are logged by the command service and never
 * surfaced, which is right for a convenience shortcut the user can repeat
 * from the menu.
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import { en, NS, zh, type SlashToolsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Slash tool copy (/clear, /help). */
    slashTools: SlashToolsKey
  }
}

/** Required services: the contribution registry, locale, and the session/workspace faces. */
export const inject = ['commandUi', 'locale', 'sessions', 'workspaces']

/**
 * Client plugin body: register the `slashTools` dictionaries, then the
 * /clear action and the /help menu.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-slash-tools: dictionaries')
  // The command description is registry-held text: it reads t() once at
  // registration and refreshes only on re-registration, not on locale change.
  const t = ctx.locale.bind(NS)

  ctx.inject(['commandUi', 'locale', 'sessions', 'workspaces'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const sessions = scope.sessions
    const workspaces = scope.workspaces
    // The /clear action: only offered on a session with something to clear
    // (a blank current session has no conversation to discard).
    scope.effect(() => command.register({
      name: 'clear',
      description: t('command.clearDescription'),
      available: session => sessions.list.getSnapshot().byId[session.sessionId]?.blank === false,
      ui: {
        kind: 'action',
        run: async (session) => {
          const summary = sessions.list.getSnapshot().byId[session.sessionId]
          if (summary === undefined || summary.blank) return
          // Join the current session's Workspace by account membership (the
          // same rule the reuse scans use); a chat session carries none.
          const workspace = workspaces.list.getSnapshot().items
            .find(item => item.sessionIds.includes(session.sessionId))
          const created = await sessions.create({
            ...(workspace?.workspaceId !== undefined ? { workspaceId: workspace.workspaceId } : {}),
            ...(summary.agentPreset !== undefined ? { agentPreset: summary.agentPreset } : {}),
          })
          sessions.open(created)
        },
      },
    }), 'ui-slash-tools: /clear action')
    // The /help menu: the merged menu face (host catalog + available client
    // contributions) as an informational listing. Picking a row closes the
    // popup — the row's own menu pick is the one that runs it.
    scope.effect(() => command.register({
      name: 'help',
      description: t('command.helpDescription'),
      available: () => true,
      ui: {
        kind: 'popupSelect',
        options: async (session, signal) => {
          const rows = await command.menuRows(session, signal)
          return rows.map(row => ({ id: row.name, label: `/${row.name}`, detail: row.description }))
        },
        // Informational listing: closing the popup is the behavior.
        onSelect: async () => { /* the rows are the answer */ },
      },
    }), 'ui-slash-tools: /help menu')
  })
}
