import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
} from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as commandSearch from '@deepseek-ai/dsh-command-search'
import type {} from '@deepseek-ai/dsh-workspace-references'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('command-search real Loader composition', () => {
  it('searches the session workspace and its reference projects with the real ripgrep', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-search-loader-'))
    const workspace = join(root, 'workspace')
    const reference = join(root, 'reference')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await mkdir(reference, { recursive: true })
    await writeFile(join(workspace, 'src', 'alpha.ts'), 'const needle = 1\n')
    await writeFile(join(workspace, 'beta.md'), 'no match here\n')
    await writeFile(join(reference, 'gamma.ts'), 'needle in the reference project\n')

    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      "- name: '@deepseek-ai/dsh-command-search'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
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

    const id = SessionId('loader-command-search')
    const session = Session.create(id, [], {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 0,
      cwd: workspace,
    })
    session.append('workspace/references', { references: [{ path: reference }] })
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent

    expect(context.commands.list(agent)).toContainEqual({
      name: 'search',
      description: 'Search this session workspace and its reference projects (literal text)',
      input: { hint: '<literal text>' },
    })

    const execution = await context.commands.execute(agent, '/search needle', new AbortController().signal)
    if (execution === undefined) throw new Error('Loader composition did not resolve /search')
    // ripgrep searches several roots in parallel, so the cross-root match
    // order is not guaranteed: assert the exact match set, order-insensitively.
    const matchLines = [
      'src/alpha.ts:1: const needle = 1',
      `${join(reference, 'gamma.ts')}:1:` +
      ' needle in the reference project',
    ]
    const expectedText = [...matchLines].sort().join('\n')
    expect(execution.result).toEqual({ kind: 'success', text: expectedText })

    const lifecycle = session.events
      .filter(event => event.type === 'command/run' || event.type === 'command/done')
      .map(event => ({ type: event.type, data: event.data }))
    expect(lifecycle).toEqual([
      {
        type: 'command/run',
        data: {
          commandId: execution.commandId,
          name: 'search',
          args: ' needle',
          source: { kind: 'user' },
        },
      },
      {
        type: 'command/done',
        data: {
          commandId: execution.commandId,
          kind: 'success',
          text: expectedText,
        },
      },
    ])
    // The search settles beside the agent: nothing joins model history.
    expect(session.surface.nodes).toEqual([])
    expect(session.deriveMessages()).toEqual([])

    const empty = await context.commands.execute(agent, '/search zzz-no-match', new AbortController().signal)
    if (empty === undefined) throw new Error('Loader composition did not resolve the second /search')
    expect(empty.result).toEqual({ kind: 'success', text: 'No matches for "zzz-no-match".' })
  })
})
