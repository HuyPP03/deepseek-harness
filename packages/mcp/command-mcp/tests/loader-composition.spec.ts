import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@open-harness/oh-agent'
import CommandRuntime from '@open-harness/oh-commands'
import SystemPrompt from '@open-harness/oh-system-prompt'
import ToolRuntime from '@open-harness/oh-tools'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@open-harness/oh-session'
import McpRegistry from '@open-harness/oh-mcp-registry'
import * as commandMcp from '@open-harness/oh-command-mcp'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('command-mcp real Loader composition', () => {
  it('lists the servers a live reporter contributes to the shared registry', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-mcp-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@open-harness/oh-system-prompt'",
      "- name: '@open-harness/oh-tools'",
      "- name: '@open-harness/oh-commands'",
      "- name: '@open-harness/oh-mcp-registry'",
      "- name: '@open-harness/oh-command-mcp'",
      "- name: 'test:stub-mcp-reporter'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@open-harness/oh-system-prompt', SystemPrompt],
      ['@open-harness/oh-tools', ToolRuntime],
      ['@open-harness/oh-commands', CommandRuntime],
      ['@open-harness/oh-mcp-registry', McpRegistry],
      ['@open-harness/oh-command-mcp', commandMcp],
      // A stand-in for an mcp-client instance: reports one stable server.
      ['test:stub-mcp-reporter', {
        name: 'stub-mcp-reporter',
        inject: ['mcpRegistry'],
        apply(ctx: Context): void {
          ctx.effect(() => ctx.mcpRegistry.report('stub', { read: () => ({
            serverName: 'stub',
            status: 'connected',
            tools: [{ name: 'mcp__stub__ping', description: 'Ping the server' }],
          }) }), 'stub-mcp-reporter lifecycle')
        },
      }],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const session = Session.create(SessionId('loader-command-mcp'), [], {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('loader-command-mcp'),
      createdAt: 0,
    })
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent

    expect(context.commands.list(agent)).toContainEqual({
      name: 'mcp',
      description: 'List the connected MCP servers and their tools',
      input: { hint: '[server]' },
      providerHidden: true,
    })

    const execution = await context.commands.execute(agent, '/mcp', new AbortController().signal)
    if (execution === undefined) throw new Error('Loader composition did not resolve /mcp')
    expect(execution.result).toEqual({
      kind: 'success',
      text: 'stub (connected) — 1 tool:\n  - mcp__stub__ping — Ping the server',
    })
    // A command result is executor-owned: it never enters the model history.
    expect(session.deriveMessages()).toEqual([])
  })
})
