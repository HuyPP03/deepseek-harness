/**
 * The `/effort` command: reporting and switching the reasoning effort of a
 * session's current model selection through the gateway's selection face —
 * the same resolution and persistence the `selectModel` wire row uses.
 *
 * One proxy per harness: the process-local selection lives in the proxy's own
 * map, so every assertion reads back through the SAME proxy that issued the
 * command, the way the single gateway of a deployment does.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  LlmAdapter, LlmRuntime, ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo, LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

class EffortAdapter extends LlmAdapter {
  constructor(
    private readonly name: string,
    private readonly models: readonly LlmModelInfo[],
    private readonly reasoning: LlmModelReasoningInfo | undefined,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.name }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.reasoning === undefined ? {} : { reasoning: this.reasoning },
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Effort tests never enter provider streaming.
  }
}

const REASONING: LlmModelReasoningInfo = {
  efforts: [
    { id: ReasoningEffortId('off'), name: 'Off' },
    { id: ReasoningEffortId('high'), name: 'High' },
    { id: ReasoningEffortId('max'), name: 'Max' },
  ],
  defaultEffort: ReasoningEffortId('high'),
}

type SelectionView = { provider: string; model: string; reasoningEffort?: string }

interface EffortHarness {
  ctx: Context
  agent: Agent
  sessionId: SessionId
  /** The proxy's own `session.models` view of the session's current selection. */
  current(): Promise<SelectionView>
  /** Every selection persisted as the deployment default, in order. */
  saved: SelectionView[]
}

let rpcCounter = 0

/** One provider/model pair the harness registers. */
interface Route {
  provider: string
  model: string
  /** The model's reasoning metadata, or nothing. */
  reasoning?: LlmModelReasoningInfo
}

interface HarnessOptions {
  /** The routes to register; defaults to the reasoning-capable DeepSeek pair. */
  routes?: Route[]
  /** The deployment default selection; defaults to the first route. */
  defaultSelection?: { provider: string; model: string }
}

/**
 * A host with the command registry, its routes, and one proxy — the
 * deployment's single gateway.
 * @param options - the routes and the default selection.
 * @param logged - an optional logged request header pinning the selection.
 * @returns the harness handles.
 */
async function harness(
  options: HarnessOptions = {},
  logged?: { provider: string; model: string; reasoningEffort?: ReasoningEffortId },
): Promise<EffortHarness> {
  const routes = options.routes ?? [
    { provider: 'deepseek-official', model: 'deepseek-reasoner', reasoning: REASONING },
    { provider: 'deepseek-official', model: 'deepseek-chat' },
  ]
  const def = options.defaultSelection ?? routes[0]!
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  // One adapter per provider: every route of a provider shares its metadata.
  for (const provider of [...new Set(routes.map(route => route.provider))]) {
    const providerRoutes = routes.filter(route => route.provider === provider)
    ctx.llm.registerAdapter([provider], new EffortAdapter(
      provider,
      providerRoutes.map(route => ({ provider: route.provider, id: route.model, name: route.model })),
      providerRoutes[0]!.reasoning,
    ))
  }
  const saved: SelectionView[] = []
  const api: ApiProxy = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: def.provider, model: def.model }),
    saveDefaultModelSelection: (selection) => {
      saved.push({
        ...selection,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      })
      return Promise.resolve()
    },
    cwd: '/tmp',
  })
  const session = ctx.sessions.create()
  if (logged !== undefined) {
    session.append('request/header', { header: { config: logged }, reason: 'initial' })
  }
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return {
    ctx,
    agent,
    sessionId: session.id,
    saved,
    async current(): Promise<SelectionView> {
      const response = await api.sessions.models({
        rpcId: RpcId(`effort-current-${String(rpcCounter++)}`),
        payload: { sessionId: session.id },
      })
      if (!response.result.ok) throw new Error(`session.models failed: ${response.result.error.message}`)
      return response.result.value.current
    },
  }
}

const signal = () => new AbortController().signal

describe('the /effort command', () => {
  it('reports the model default effort when the selection names none', async () => {
    const { ctx, agent } = await harness()

    const run = await ctx.commands.execute(agent, '/effort', signal())

    expect(run?.result).toEqual({
      kind: 'success',
      text: 'effort high (supported: Off, High, Max; default: high)',
    })
  })

  it('reports a logged effort above the model default', async () => {
    const { ctx, agent } = await harness(undefined, {
      provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: ReasoningEffortId('max'),
    })

    const run = await ctx.commands.execute(agent, '/effort', signal())

    expect(run?.result).toEqual({
      kind: 'success',
      text: 'effort max (supported: Off, High, Max; default: high)',
    })
  })

  it('switches by effort name, records it on the selection, and saves the default', async () => {
    const h = await harness()

    const run = await h.ctx.commands.execute(h.agent, '/effort Max', signal())

    expect(run?.result).toEqual({ kind: 'success', text: 'effort max' })
    expect(await h.current()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      reasoningEffort: 'max',
    })
    expect(h.saved).toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      reasoningEffort: 'max',
    }])
  })

  it('matches effort ids exactly and names case-insensitively', async () => {
    const { ctx, agent } = await harness()

    const byId = await ctx.commands.execute(agent, '/effort off', signal())
    expect(byId?.result).toEqual({ kind: 'success', text: 'effort off' })
    const byName = await ctx.commands.execute(agent, '/effort oFF', signal())
    expect(byName?.result).toEqual({ kind: 'success', text: 'effort off' })
  })

  it('refuses an unknown effort and names the supported set', async () => {
    const h = await harness()

    const run = await h.ctx.commands.execute(h.agent, '/effort turbo', signal())

    expect(run?.result).toEqual({
      kind: 'error',
      text: 'unknown effort "turbo" (supported: Off, High, Max)',
    })
    expect(await h.current()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-reasoner',
    })
    expect(h.saved).toEqual([])
  })

  it('answers a model without reasoning metadata with a no-effort report', async () => {
    const h = await harness({
      routes: [{ provider: 'plain', model: 'chat' }],
      defaultSelection: { provider: 'plain', model: 'chat' },
    })
    const { ctx, agent } = h

    const report = await ctx.commands.execute(agent, '/effort', signal())
    expect(report?.result).toEqual({
      kind: 'success',
      text: 'model "chat" has no selectable reasoning effort',
    })
    const attempt = await ctx.commands.execute(agent, '/effort high', signal())
    expect(attempt?.result).toEqual({
      kind: 'error',
      text: 'model "chat" has no selectable reasoning effort',
    })
  })

  it('switches even while the agent runs a turn — the selection takes effect on the next turn', async () => {
    const h = await harness()
    ;(h.agent as unknown as { status: string }).status = 'running'

    const run = await h.ctx.commands.execute(h.agent, '/effort off', signal())

    // No busy gate: effort is request-header state, and the selectModel wire
    // row it mirrors switches a running session the same way.
    expect(run?.result).toEqual({ kind: 'success', text: 'effort off' })
    expect(h.saved).toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      reasoningEffort: 'off',
    }])
  })
})
