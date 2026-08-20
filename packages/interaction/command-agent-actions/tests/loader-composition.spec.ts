import { pathToFileURL } from 'node:url'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as commandAgentActions from '@deepseek-ai/dsh-command-agent-actions'
import { ScriptedReviewer } from './scripted-reviewer'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function compose(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'dsh-command-agent-actions-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: '@deepseek-ai/dsh-command-agent-actions'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-command-agent-actions', commandAgentActions],
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

function agentWithChangedFile(filePath: string): Agent {
  const id = SessionId('loader-command-agent-actions')
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 0 }
  const session = Session.create(id, [], header)
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: CallId('call-1'),
    name: 'write',
    arguments: JSON.stringify({ file_path: filePath }),
  })
  return {
    session,
    status: 'idle',
    steer: () => {},
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
}

describe('command-agent-actions real Loader composition', () => {
  it('steers for /simplify and folds a four-facet /code-review report', async () => {
    const agent = agentWithChangedFile('src/a.ts')
    await compose()
    const reviewer = new ScriptedReviewer('spawn', [
      { reply: 'loader correctness', settleMs: 0 },
      { reply: 'loader security', settleMs: 0 },
      { reply: 'loader performance', settleMs: 0 },
      { reply: 'loader maintainability', settleMs: 0 },
    ])
    context!.subagents.registerProvider(reviewer)

    const listed = context!.commands.list(agent)
    expect(listed).toContainEqual({
      name: 'simplify',
      description: 'Ask the agent to simplify the code touched in this session',
    })
    expect(listed).toContainEqual({
      name: 'code-review',
      description: 'Review the code changed in this session with four parallel reviewers (report only)',
    })

    const simplify = await context!.commands.execute(agent, '/simplify', new AbortController().signal)
    if (simplify === undefined) throw new Error('Loader composition did not resolve /simplify')
    expect(simplify.result).toEqual({ kind: 'success', text: 'Simplification queued for this session.' })

    const review = await context!.commands.execute(agent, '/code-review', new AbortController().signal)
    if (review === undefined) throw new Error('Loader composition did not resolve /code-review')
    expect(review.result.kind).toBe('success')
    const text = (review.result as { text: string }).text
    expect(text).toContain('Code review of 1 changed file (report-only):')
    expect(text).toContain('loader correctness')
    expect(text).toContain('loader security')
    expect(text).toContain('loader performance')
    expect(text).toContain('loader maintainability')
    expect(reviewer.requests).toHaveLength(4)
    expect(reviewer.requests.map(request => request.parent.session.id)).toEqual([
      agent.session.id,
      agent.session.id,
      agent.session.id,
      agent.session.id,
    ])

    const lifecycle = agent.session.events
      .filter(event => event.type === 'command/run' || event.type === 'command/done')
      .map(event => ({ type: event.type, data: event.data }))
    expect(lifecycle).toHaveLength(4)
    expect(lifecycle[0]?.data).toMatchObject({ name: 'simplify', args: '', source: { kind: 'user' } })
    expect(lifecycle[1]?.data).toMatchObject({ kind: 'success', text: 'Simplification queued for this session.' })
    expect(lifecycle[2]?.data).toMatchObject({ name: 'code-review', args: '', source: { kind: 'user' } })
    expect(lifecycle[3]?.data).toMatchObject({ kind: 'success', text })
    expect(agent.session.surface.nodes).toEqual([])
  })

  it('falls back to a steering message when no provider is registered', async () => {
    const agent = agentWithChangedFile('src/a.ts')
    await compose()
    const review = await context!.commands.execute(agent, '/code-review', new AbortController().signal)
    if (review === undefined) throw new Error('Loader composition did not resolve /code-review')
    expect(review.result).toEqual({
      kind: 'success',
      text: 'Subagent provider "spawn" is not available in this deployment; the review was queued on this agent instead.',
    })
  })
})
