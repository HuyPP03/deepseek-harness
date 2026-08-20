/**
 * `/mode`: switching a session's agent preset after its conversation started.
 *
 * Real-composition lane: a booted host with the registries a preset writes to,
 * the command registry, and a mock LLM — so a switch is asserted on the model
 * (the tool schemas of the NEXT request), not on the join. The fixtures each
 * contribute one named tool, so every switch is observable in the catalog.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const MODE_ROOTS = [{ path: join(FIXTURES, 'mode-presets'), trust: 'system' as const }]

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/** A model response script entry: one canned text, or a hang until aborted. */
type Script = (ReturnType<typeof textResponse> | 'hang')[]

/**
 * A booted host carrying the preset roster, the command registry, and a mock
 * LLM scripted by each test.
 * @param script - the model responses the tests will consume.
 * @param chatPresetIds - presets pinned as chat surfaces for the guard tests.
 * @returns the booted context and its adapter.
 */
async function harness(
  script: Script,
  chatPresetIds: string[] = [],
): Promise<{ ctx: Context; adapter: MockAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentPresets, {
    default: 'alpha', roots: MODE_ROOTS, includeUserRoot: false, chatPresetIds,
  })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

/** Create one agent composed from `presetId`, exactly as a factory `setup` would. */
async function agentOn(
  ctx: Context, id: string, presetId: string,
  meta?: { agentPreset?: string },
): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    agentOptions: { provider: 'mock', model: 'mock' },
    ...meta === undefined ? {} : { meta },
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
  return handle.agent
}

/** The agent's model-facing catalog, sorted. */
const catalog = (ctx: Context, agent: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()

/** One user turn, settled. */
async function turn(agent: Agent, text = 'start'): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

const signal = () => new AbortController().signal
const errorText = (result: { kind: string } & Record<string, unknown>): string =>
  result.kind === 'error' ? String(result.text) : '<not an error>'

describe('the /mode command', () => {
  it('reports the current preset and roster with no argument', async () => {
    const { ctx } = await harness([textResponse('ok')])
    const agent = await agentOn(ctx, 'mode-bare', 'alpha', { agentPreset: 'alpha' })
    await turn(agent)

    const run = await ctx.commands.execute(agent, '/mode', signal())

    expect(run?.result).toEqual({
      kind: 'success',
      text: 'current preset alpha (available: alpha, beta, chatlike, gamma)',
    })
    // A bare report changes nothing and records no switch.
    expect(catalog(ctx, agent)).toEqual(['alpha_tool'])
    expect(agent.session.events.some(event => event.type === 'agent-preset/selected')).toBe(false)
  })

  it('switches a started session, records it, and the next turn runs under the new preset', async () => {
    const { ctx, adapter } = await harness([textResponse('first'), textResponse('second')])
    const agent = await agentOn(ctx, 'mode-switch', 'alpha')
    await turn(agent)
    expect(catalog(ctx, agent)).toEqual(['alpha_tool'])

    const run = await ctx.commands.execute(agent, '/mode beta', signal())

    expect(run?.result).toEqual({ kind: 'success', text: 'preset beta' })
    // The switch is logged; the conversation history is intact.
    expect(agent.session.events.filter(event => event.type === 'agent-preset/selected')
      .map(event => event.data.agentPreset)).toEqual(['beta'])
    expect(agent.session.events.some(event => event.type === 'turn/start')).toBe(true)
    // The command recorded no args — the selected event owns the payload.
    const runEvent = agent.session.events.find(event => event.type === 'command/run')
    expect(runEvent).toBeDefined()
    expect(runEvent && 'args' in runEvent.data).toBe(false)
    // The catalog follows immediately; the MODEL follows on the next turn.
    expect(catalog(ctx, agent)).toEqual(['beta_tool'])
    await turn(agent, 'second')
    expect(adapter.requests.at(-1)?.tools?.map(tool => tool.name)).toEqual(['beta_tool'])
  })

  it('switches a blank session, exactly like the seat flow', async () => {
    const { ctx } = await harness([textResponse('ok')])
    const agent = await agentOn(ctx, 'mode-blank', 'alpha')

    const run = await ctx.commands.execute(agent, '/mode beta', signal())

    expect(run?.result).toEqual({ kind: 'success', text: 'preset beta' })
    expect(agent.session.events.filter(event => event.type === 'agent-preset/selected')
      .map(event => event.data.agentPreset)).toEqual(['beta'])
    expect(catalog(ctx, agent)).toEqual(['beta_tool'])
  })

  it('refuses an unknown preset and names the roster', async () => {
    const { ctx } = await harness([textResponse('ok')])
    const agent = await agentOn(ctx, 'mode-unknown', 'alpha')

    const run = await ctx.commands.execute(agent, '/mode nope', signal())

    expect(run?.result).toEqual({
      kind: 'error',
      text: 'unknown preset "nope" (available: alpha, beta, chatlike, gamma)',
    })
    expect(catalog(ctx, agent)).toEqual(['alpha_tool'])
    expect(agent.session.events.some(event => event.type === 'agent-preset/selected')).toBe(false)
  })

  it('refuses to switch into a configured chat preset', async () => {
    const { ctx } = await harness([textResponse('ok')], ['chatlike'])
    const agent = await agentOn(ctx, 'mode-chat-into', 'alpha')

    const run = await ctx.commands.execute(agent, '/mode chatlike', signal())

    expect(run?.result.kind).toBe('error')
    expect(errorText(run!.result)).toContain('chat session')
    expect(catalog(ctx, agent)).toEqual(['alpha_tool'])
    expect(agent.session.events.some(event => event.type === 'agent-preset/selected')).toBe(false)
  })

  it('refuses to switch out of a configured chat preset', async () => {
    const { ctx } = await harness([textResponse('ok')], ['chatlike'])
    // A chat session is created ONTO its preset, so the header names it.
    const agent = await agentOn(ctx, 'mode-chat-out', 'chatlike', { agentPreset: 'chatlike' })

    const run = await ctx.commands.execute(agent, '/mode alpha', signal())

    expect(run?.result.kind).toBe('error')
    expect(errorText(run!.result)).toContain('chat session')
    expect(catalog(ctx, agent)).toEqual(['chatlike_tool'])
  })

  it('refuses while a turn runs, then succeeds once it settles', async () => {
    const { ctx } = await harness(['hang', textResponse('ok')])
    const agent = await agentOn(ctx, 'mode-busy', 'alpha')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'slow' }], source: { kind: 'user' } }))
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (agent.status === 'running') {
          clearInterval(timer)
          resolve()
        }
      }, 5)
    })

    const busy = await ctx.commands.execute(agent, '/mode beta', signal())

    expect(busy?.result.kind).toBe('error')
    expect(errorText(busy!.result)).toContain('runs a turn')
    expect(catalog(ctx, agent)).toEqual(['alpha_tool'])

    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    const settled = await ctx.commands.execute(agent, '/mode beta', signal())
    expect(settled?.result).toEqual({ kind: 'success', text: 'preset beta' })
    expect(catalog(ctx, agent)).toEqual(['beta_tool'])
  })

  it('serializes concurrent switches on one session, last caller wins', async () => {
    const { ctx } = await harness([textResponse('ok')])
    const agent = await agentOn(ctx, 'mode-race', 'alpha')
    await turn(agent)

    const [first, second] = await Promise.all([
      ctx.commands.execute(agent, '/mode beta', signal()),
      ctx.commands.execute(agent, '/mode gamma', signal()),
    ])

    expect(first?.result).toEqual({ kind: 'success', text: 'preset beta' })
    expect(second?.result).toEqual({ kind: 'success', text: 'preset gamma' })
    const selected = agent.session.events
      .filter(event => event.type === 'agent-preset/selected')
      .map(event => event.data.agentPreset)
    expect(selected).toEqual(['beta', 'gamma'])
    expect(catalog(ctx, agent)).toEqual(['gamma_tool'])
  })
})
