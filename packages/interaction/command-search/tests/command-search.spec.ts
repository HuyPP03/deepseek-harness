import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import * as commandSearch from '@deepseek-ai/dsh-command-search'

const QUEUED_TEXT = 'Search queued for this session.'
const USAGE_TEXT = 'Usage: /search <query> — asks the agent to search this session workspace and list the matching files'

/** The pinned model-facing steering directive for one query. */
function directiveFor(query: string): string {
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

interface Harness {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly steer: ReturnType<typeof vi.fn>
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  const plugin = await ctx.plugin(commandSearch)
  const id = SessionId('command-search')
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 0 }
  const session = Session.create(id, [], header)
  const steer = vi.fn()
  const agent = {
    session,
    status: 'idle',
    steer,
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { ctx, session, agent, steer, plugin }
}

async function run(
  test: Harness,
  line: string,
  controller = new AbortController(),
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>> {
  const execution = await test.ctx.commands.execute(test.agent, line, controller.signal)
  if (execution === undefined) throw new Error('command was not registered')
  return execution
}

/** The one steered user message. */
function steeredMessage(test: Harness): { text: string; source: { kind: string; plugin?: string } } {
  expect(test.steer).toHaveBeenCalledTimes(1)
  const call = test.steer.mock.calls[0]
  if (call === undefined) throw new Error('expected one steer call')
  const message = call[0] as {
    content: readonly { type: string; text?: string }[]
    source: { kind: string; plugin?: string }
  }
  const firstText = message.content.find(block => block.type === 'text')?.text
  if (firstText === undefined) throw new Error('expected a text block in the steered message')
  return { text: firstText, source: message.source }
}

/** Assert the executor-owned lifecycle pair and absence from model history. */
function expectLastLifecycle(
  test: Harness,
  args: string,
  outcome: { kind: string; text?: string },
): void {
  const lifecycle = test.session.events
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .slice(-2)
  const runEvent = lifecycle[0]
  const doneEvent = lifecycle[1]
  if (runEvent?.type !== 'command/run' || doneEvent?.type !== 'command/done') {
    throw new Error(`expected command lifecycle pair, got ${lifecycle.map(event => event.type).join(',')}`)
  }
  expect(lifecycle.map(event => ({ type: event.type, data: event.data }))).toEqual([
    {
      type: 'command/run',
      data: { commandId: runEvent.data.commandId, name: 'search', args, source: { kind: 'user' } },
    },
    {
      type: 'command/done',
      data: { commandId: doneEvent.data.commandId, kind: outcome.kind, ...(outcome.text === undefined ? {} : { text: outcome.text }) },
    },
  ])
  expect(test.session.surface.nodes).toEqual([])
  expect(test.session.deriveMessages()).toEqual([])
}

describe('@deepseek-ai/dsh-command-search registration', () => {
  it('registers the search command and disposes it', async () => {
    const test = await harness()
    try {
      expect(commandSearch.name).toBe('command-search')
      expect(commandSearch.inject).toEqual(['commands'])
      expect('default' in commandSearch).toBe(false)
      const loader = Object.create(Loader.prototype) as Loader
      expect(loader.unwrapExports(commandSearch)).toBe(commandSearch)
      expect(test.ctx.commands.list(test.agent)).toContainEqual({
        name: 'search',
        description: 'Ask the agent to search this session workspace and list the matching files',
        input: { hint: '<query>' },
      })
    } finally {
      await test.plugin.dispose()
    }
    expect(test.ctx.commands.list(test.agent)).toEqual([])
  })
})

describe('/search', () => {
  it('steers the agent with the search directive and settles log-only', async () => {
    const test = await harness()
    try {
      const execution = await run(test, '/search auth middleware')
      expect(execution.result).toEqual({ kind: 'success', text: QUEUED_TEXT })
      expect(steeredMessage(test).text).toBe(directiveFor('auth middleware'))
      expect(steeredMessage(test).source).toEqual({ kind: 'plugin', plugin: 'command-search' })
      expectLastLifecycle(test, ' auth middleware', { kind: 'success', text: QUEUED_TEXT })
    } finally {
      await test.plugin.dispose()
    }
  })

  it('carries the user query verbatim into the directive, trimmed', async () => {
    const test = await harness()
    try {
      const execution = await run(test, '/search   "token refresh" — ví dụ 中文  ')
      expect(execution.result).toEqual({ kind: 'success', text: QUEUED_TEXT })
      expect(steeredMessage(test).text).toBe(directiveFor('"token refresh" — ví dụ 中文'))
    } finally {
      await test.plugin.dispose()
    }
  })

  it('refuses an empty query with usage and steers nothing', async () => {
    const test = await harness()
    try {
      const execution = await run(test, '/search')
      expect(execution.result).toEqual({ kind: 'error', text: USAGE_TEXT })
      expect(test.steer).not.toHaveBeenCalled()
      expectLastLifecycle(test, '', { kind: 'error', text: USAGE_TEXT })
    } finally {
      await test.plugin.dispose()
    }
  })

  it('refuses a whitespace-only query with usage and steers nothing', async () => {
    const test = await harness()
    try {
      const execution = await run(test, '/search    ')
      expect(execution.result).toEqual({ kind: 'error', text: USAGE_TEXT })
      expect(test.steer).not.toHaveBeenCalled()
      expectLastLifecycle(test, '    ', { kind: 'error', text: USAGE_TEXT })
    } finally {
      await test.plugin.dispose()
    }
  })

  it('settles while the agent is running: the steer is consumed at the next step boundary', async () => {
    const test = await harness()
    try {
      ;(test.agent as unknown as { status: string }).status = 'running'
      const execution = await run(test, '/search todo markers')
      expect(execution.result).toEqual({ kind: 'success', text: QUEUED_TEXT })
      expect(steeredMessage(test).text).toBe(directiveFor('todo markers'))
    } finally {
      await test.plugin.dispose()
    }
  })
})
