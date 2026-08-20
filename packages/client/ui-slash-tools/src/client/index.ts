/**
 * Slash tools plugin, browser half: client-owned slash entries whose behavior
 * lives entirely on the client. Today: the /clear ACTION — a menu pick or a
 * bare enter starts a fresh blank session in the current session's workspace
 * (and preset, when the deployment composes one) and opens it. The current
 * session stays in the list untouched; its references do not carry over
 * (the list summary carries no reference axis, so the action cannot see them).
 * The action kind has no result channel: create or open failures are logged
 * by the command service and never surfaced, which is right for a
 * convenience shortcut that the user can repeat from the menu.
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import { en, NS, zh, type SlashToolsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Slash tool copy (/clear). */
    slashTools: SlashToolsKey
  }
}

/** Required services: the contribution registry, locale, and the session/workspace faces. */
export const inject = ['commandUi', 'locale', 'sessions', 'workspaces']

/**
 * Client plugin body: register the `slashTools` dictionaries, then the
 * /clear action contribution.
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
  })
}
