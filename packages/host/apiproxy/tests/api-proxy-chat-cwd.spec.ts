/**
 * A chat session (a create request carrying neither a workspace nor a cwd)
 * lands in its own per-session sandbox directory supplied by
 * `ApiProxyDefaults.chatCwdFor` — the gateway maps that to `<harness home>/chat/<sessionId>`;
 * an explicit cwd still wins, and a direct createApiProxy caller without a
 * chat mapper keeps the flat process-cwd default.
 */

import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy, type ApiProxyDefaults } from '../src/api-proxy.ts'
import { describe, expect, it } from 'vitest'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`chatcwd-${String(nextRpc++)}`), payload }
}

/** Minimal live agent; the gateway only needs identity and its session. */
function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness(defaults: Record<string, unknown>): Promise<{ api: ReturnType<typeof createApiProxy>; ctx: Context }> {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-chatcwd-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await options.setup?.(agentCtx)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
    ...defaults as Partial<ApiProxyDefaults>,
  })
  return { api, ctx }
}

describe('chat session default project directory', () => {
  it('maps a workspace-less, cwd-less create to chatCwdFor and creates the sandbox directory', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-apiproxy-chathome-'))
    const { api, ctx } = await harness({
      chatCwdFor: (sessionId: SessionId) => join(home, 'chat', sessionId),
    })

    const created = await api.sessions.create(request({ sessionId: SessionId('s-chat') }))
    expect(created.result.ok).toBe(true)
    const header = ctx.sessions.get(SessionId('s-chat'))!.header
    expect(header.cwd).toBe(join(home, 'chat', 's-chat'))
    expect(existsSync(join(home, 'chat', 's-chat'))).toBe(true)
  })

  it('keeps the explicit create cwd over the chat mapping', async () => {
    const explicit = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-chatcwd-explicit-')))
    const { api, ctx } = await harness({
      chatCwdFor: (sessionId: SessionId) => join('/unused', 'chat', sessionId),
    })

    const created = await api.sessions.create(request({ sessionId: SessionId('s-explicit'), cwd: explicit }))
    expect(created.result.ok).toBe(true)
    const header = ctx.sessions.get(SessionId('s-explicit'))!.header
    expect(header.cwd).toBe(explicit)
  })

  it('falls back to the flat cwd default when no chat mapper is supplied', async () => {
    const { api, ctx } = await harness({})

    const created = await api.sessions.create(request({ sessionId: SessionId('s-plain') }))
    expect(created.result.ok).toBe(true)
    const header = ctx.sessions.get(SessionId('s-plain'))!.header
    expect(header.cwd).toBeDefined()
    expect(header.cwd).not.toContain('/chat/')
  })

  it('maps the gateway chat sandbox under the harness home', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-apiproxy-chathome-env-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const sessionId = SessionId('s-env')
      expect(dshHomePath('chat', sessionId)).toBe(join(home, 'chat', 's-env'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
