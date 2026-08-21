import { pathToFileURL } from 'node:url'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import * as commandSearch from '@deepseek-ai/dsh-command-search'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function compose(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'dsh-command-search-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-command-search'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-command-search', commandSearch],
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
}

describe('command-search real Loader composition', () => {
  it('steers the agent with the query and settles the lifecycle', async () => {
    await compose()
    const steer = vi.fn()
    const id = SessionId('loader-command-search')
    const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 0 }
    const session = Session.create(id, [], {
      ...header,
      cwd: '/tmp/dsh-search-cwd',
    })
    const agent = {
      session,
      status: 'idle',
      steer,
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent

    expect(context!.commands.list(agent)).toContainEqual({
      name: 'search',
      description: 'Ask the agent to search this session workspace and list the matching files',
      input: { hint: '<query>' },
    })

    const execution = await context!.commands.execute(agent, '/search auth middleware', new AbortController().signal)
    if (execution === undefined) throw new Error('Loader composition did not resolve /search')
    expect(execution.result).toEqual({ kind: 'success', text: 'Search queued for this session.' })

    // The command steers the agent; the search is the agent's own turn, so
    // nothing runs beside it and nothing joins model history yet.
    expect(steer).toHaveBeenCalledTimes(1)
    const message = steer.mock.calls[0]?.[0] as { content: readonly { type: string; text?: string }[] }
    const text = message.content.find(block => block.type === 'text')?.text
    expect(text).toContain("Search this session's workspace for: auth middleware")
    expect(session.surface.nodes).toEqual([])
    expect(session.deriveMessages()).toEqual([])

    const lifecycle = session.events
      .filter(event => event.type === 'command/run' || event.type === 'command/done')
      .map(event => ({ type: event.type, data: event.data }))
    expect(lifecycle).toEqual([
      {
        type: 'command/run',
        data: {
          commandId: execution.commandId,
          name: 'search',
          args: ' auth middleware',
          source: { kind: 'user' },
        },
      },
      {
        type: 'command/done',
        data: {
          commandId: execution.commandId,
          kind: 'success',
          text: 'Search queued for this session.',
        },
      },
    ])
  })
})
