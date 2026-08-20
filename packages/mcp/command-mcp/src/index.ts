/**
 * Human-facing `/mcp` command: lists the connected MCP servers and the tools
 * each has registered, from the shared `mcpRegistry` snapshot. `/mcp <server>`
 * narrows the listing to one server. The command never touches a model turn:
 * it reads an in-memory snapshot and settles through the
 * `command/run`/`command/done` pair.
 *
 * @module @deepseek-ai/dsh-command-mcp
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-registry'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'command-mcp'

/** Services required by this plugin. */
export const inject = ['commands', 'mcpRegistry']

/** The result when no MCP client is reporting. */
const NO_SERVERS = 'No MCP servers are connected.'

/** Render one server and its registered tools as the listing block. */
function renderServer(view: McpServerView): string {
  if (view.tools.length === 0) return `${view.serverName} (${view.status}) — no tools`
  const lines = view.tools.map(tool => `  - ${tool.name}${tool.description === '' ? '' : ` — ${tool.description}`}`)
  const plural = view.tools.length === 1 ? 'tool' : 'tools'
  return [`${view.serverName} (${view.status}) — ${view.tools.length} ${plural}:`, ...lines].join('\n')
}

/**
 * Register the `/mcp` command.
 * @param ctx - Cordis context providing the command runtime and the MCP registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'mcp',
    description: 'List the connected MCP servers and their tools',
    input: { hint: '[server]' },
    handler: (invocation: CommandInvocation): CommandResult => {
      const server = invocation.rawInput.trim()
      const views = ctx.mcpRegistry.servers()
      if (server === '') {
        return {
          kind: 'success',
          text: views.length === 0 ? NO_SERVERS : views.map(renderServer).join('\n\n'),
        }
      }
      const view = views.find(candidate => candidate.serverName === server)
      if (view === undefined) {
        const available = views.length === 0 ? '' : ` (available: ${views.map(candidate => candidate.serverName).join(', ')})`
        return { kind: 'error', text: `Unknown MCP server "${server}"${available}.` }
      }
      return { kind: 'success', text: renderServer(view) }
    },
  }), 'command-mcp lifecycle')
}
