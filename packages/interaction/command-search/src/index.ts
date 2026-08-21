/**
 * Human-facing `/search` command: steer the session's agent to search its
 * own workspace for a query and reply with a concrete file list.
 *
 * The handler runs no search of its own: it composes one search directive
 * from the user's query and steers the agent with it, so the searching is
 * the agent's own turn — the file searches, the reads, and the final list
 * all happen inside that turn and are recorded in the session log. The
 * command result only confirms the search is queued; the file list arrives
 * as the agent's reply.
 *
 * @module @deepseek-ai/dsh-command-search
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'

export const name = 'command-search'
export const inject = ['commands']

/** The no-argument result: the command takes one query. */
const USAGE = 'Usage: /search <query> — asks the agent to search this session workspace and list the matching files'

/** The command composes its steering text; the user's line reaches the model only inside the directive. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'command-search' }

/**
 * Steer directive for /search: the agent searches its own workspace and
 * reports a concrete file list rather than raw match output.
 * @param query - the user's search query, verbatim.
 * @returns the steering text.
 */
function searchDirective(query: string): string {
  return (
    `Search this session's workspace for: ${query}\n\n` +
    'Use your search tools (grep for content, glob for paths, read to confirm) ' +
    'to find the files that match or are relevant to the query above. ' +
    'Then reply with a concrete list of the matching files: each entry is the ' +
    'file path followed by a one-line note on what it contains or why it matches. ' +
    'Deduplicate paths and order the list by relevance; do not dump raw grep ' +
    'output. If nothing matches, say so in a single line and stop.'
  )
}

/**
 * Execute one /search: steer the receiving agent with the search directive.
 * An idle agent starts a turn; a running agent consumes the steering at its
 * next step boundary. The agent's turn is the search, so the file list
 * settles as the agent's reply rather than as this command's result.
 * @param invocation - the command invocation.
 * @returns the command result confirming the queued search.
 */
function executeSearch(invocation: CommandInvocation): CommandResult {
  invocation.agent.steer(createUserMessage({
    content: [{ type: 'text', text: searchDirective(invocation.rawInput.trim()) }],
    source: PLUGIN_SOURCE,
  }))
  return { kind: 'success', text: 'Search queued for this session.' }
}

/**
 * Register `/search` for every composed human-command adapter.
 * @param ctx - context carrying the command registry.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = invocation.rawInput.trim() === ''
      ? Promise.resolve<CommandResult>({ kind: 'error', text: USAGE })
      : Promise.resolve(executeSearch(invocation))
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'search',
      description: 'Ask the agent to search this session workspace and list the matching files',
      input: { hint: '<query>' },
      handler,
    })
  }, 'command-search lifecycle')
}
