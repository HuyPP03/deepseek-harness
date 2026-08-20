import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-registry'
import * as commandMcp from '@deepseek-ai/dsh-command-mcp'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(McpRegistry)
  const plugin = await ctx.plugin(commandMcp)
  const id = SessionId('command-mcp')
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 0 }
  const session = Session.create(id, [], header)
  const agent = {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { ctx, agent, plugin }
}

/** Build one server view with `toolCount` placeholder tools. */
function view(serverName: string, toolCount: number, status: McpServerView['status'] = 'connected'): McpServerView {
  return {
    serverName,
    status,
    tools: Array.from({ length: toolCount }, (_, index) => ({
      name: `mcp__${serverName}__tool${index}`,
      description: `tool ${index} does things`,
    })),
  }
}

async function run(test: Harness, line: string): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(test.agent, line, new AbortController().signal)
  if (execution === undefined) throw new Error('mcp command was not registered')
  const result = execution.result
  if (result === undefined) throw new Error('mcp command returned no result')
  return result
}

describe('@deepseek-ai/dsh-command-mcp registration', () => {
  it('registers the command with an optional server input and disposes it', async () => {
    const test = await harness()
    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'mcp',
      description: 'List the connected MCP servers and their tools',
      input: { hint: '[server]' },
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.list(test.agent)).not.toContainEqual(expect.objectContaining({ name: 'mcp' }))
  })

  it('answers a bare invocation with the no-servers notice when nothing reports', async () => {
    const test = await harness()
    const result = await run(test, '/mcp')
    expect(result).toEqual({ kind: 'success', text: 'No MCP servers are connected.' })
  })
})

describe('/mcp listing', () => {
  it('lists every reported server with its status and tools, sorted by name', async () => {
    const test = await harness()
    test.ctx.mcpRegistry.report('web', () => view('web', 1))
    test.ctx.mcpRegistry.report('github', () => view('github', 2, 'reconnecting'))

    const result = await run(test, '/mcp')
    expect(result.kind).toBe('success')
    expect(result.text).toEqual([
      'github (reconnecting) — 2 tools:',
      '  - mcp__github__tool0 — tool 0 does things',
      '  - mcp__github__tool1 — tool 1 does things',
      '',
      'web (connected) — 1 tool:',
      '  - mcp__web__tool0 — tool 0 does things',
    ].join('\n'))
  })

  it('reports a server with no registered tools as a one-line entry', async () => {
    const test = await harness()
    test.ctx.mcpRegistry.report('down', () => view('down', 0, 'down'))

    const result = await run(test, '/mcp')
    expect(result).toEqual({ kind: 'success', text: 'down (down) — no tools' })
  })

  it('renders a description-less tool without a trailing separator', async () => {
    const test = await harness()
    test.ctx.mcpRegistry.report('plain', () => ({
      serverName: 'plain',
      status: 'connected',
      tools: [{ name: 'mcp__plain__bare', description: '' }],
    }))

    const result = await run(test, '/mcp')
    expect(result).toEqual({ kind: 'success', text: 'plain (connected) — 1 tool:\n  - mcp__plain__bare' })
  })

  it('narrows to one server by name', async () => {
    const test = await harness()
    test.ctx.mcpRegistry.report('github', () => view('github', 1))
    test.ctx.mcpRegistry.report('web', () => view('web', 3))

    const result = await run(test, '/mcp github')
    expect(result).toEqual({ kind: 'success', text: 'github (connected) — 1 tool:\n  - mcp__github__tool0 — tool 0 does things' })
  })

  it('rejects an unknown server and names the available ones', async () => {
    const test = await harness()
    test.ctx.mcpRegistry.report('github', () => view('github', 0))
    test.ctx.mcpRegistry.report('web', () => view('web', 0))

    const result = await run(test, '/mcp missing')
    expect(result).toEqual({ kind: 'error', text: 'Unknown MCP server "missing" (available: github, web).' })
  })

  it('rejects an unknown server without the available list when nothing reports', async () => {
    const test = await harness()
    const result = await run(test, '/mcp missing')
    expect(result).toEqual({ kind: 'error', text: 'Unknown MCP server "missing".' })
  })
})
