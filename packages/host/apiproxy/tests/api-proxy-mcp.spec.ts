/**
 * mcp RPC domain over createApiProxy: the union view (profile + user rows
 * with the managed flag), the add/remove/reconnect lifecycle with its stable
 * error codes, and the optional-composition fallback when a deployment
 * mounts no mcp-registry or mcp-manager.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '../src/api-proxy.ts'
import type { RpcRequest, RpcResponse } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'

// The manager mounts real mcp-client instances; mock only the MCP SDK.
const { MockClient } = vi.hoisted(() => {
  const mockConnect = vi.fn(async () => {})
  const mockClose = vi.fn(async function (this: { onclose?: () => void }) { this.onclose?.() })
  const mockRequest = vi.fn(async (request: { method: string }) => {
    if (request.method === 'tools/list') return { tools: [{ name: 'remote', inputSchema: { type: 'object' } }], nextCursor: undefined }
    throw new Error(`unexpected MCP request: ${request.method}`)
  })
  class MockClient {
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    request = mockRequest
    setNotificationHandler = vi.fn()
  }
  return { MockClient }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }))

const DEFAULTS = { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`mcp-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectErr(response: RpcResponse<unknown>): { code: string; details: Record<string, unknown> } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return { code: response.result.error.code, details: response.result.error.details }
}

/** A stand-in for a profile-declared mcp-client instance. */
function profileReporter(serverName: string) {
  return {
    name: `profile-${serverName}`,
    inject: ['mcpRegistry'],
    apply(ctx: Context): void {
      ctx.effect(() => ctx.mcpRegistry.report(serverName, {
        read: () => ({
          serverName,
          status: 'connected',
          tools: [{ name: `mcp__${serverName}__ping`, description: 'Ping' }],
        }),
      }), 'profile reporter lifecycle')
    },
  }
}

async function harness(options: {
  mcpDir?: string
  profile?: readonly string[]
  manager?: boolean
  registry?: boolean
}): Promise<{ ctx: Context; api: ReturnType<typeof createApiProxy>; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  if (options.registry !== false) await ctx.plugin(McpRegistry)
  if (options.manager !== false) {
    await ctx.plugin(McpManager, options.mcpDir === undefined ? {} : { mcpDir: options.mcpDir })
  }
  for (const serverName of options.profile ?? []) {
    await ctx.plugin(profileReporter(serverName))
  }
  const api = createApiProxy(ctx, DEFAULTS)
  return { ctx, api, dispose: () => ctx.fiber.dispose() }
}

describe('mcp RPC domain', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-api-mcp-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('lists no servers when no registry is composed', async () => {
    const { api, dispose } = await harness({ registry: false, manager: false })
    try {
      expect(expectOk(await api.mcp.list(request({})))).toEqual({ servers: [] })
    } finally {
      await dispose()
    }
  })

  it('lists profile and user rows with the managed flag, sorted by serverName', async () => {
    const { ctx, api, dispose } = await harness({ mcpDir: dir, profile: ['profiled'] })
    try {
      await ctx.mcpManager.add({ serverName: 'zebra', transport: 'stdio', command: 'echo', args: [], env: {}, cwd: '' })
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__zebra__remote')).toBeDefined()
      })
      const value = expectOk(await api.mcp.list(request({})))
      expect(value.servers).toEqual([
        {
          serverName: 'profiled',
          status: 'connected',
          managed: false,
          tools: [{ name: 'mcp__profiled__ping', description: 'Ping' }],
        },
        {
          serverName: 'zebra',
          status: 'connected',
          managed: true,
          tools: [{ name: 'mcp__zebra__remote', description: '' }],
        },
      ])
    } finally {
      await dispose()
    }
  })

  it('adds a user server and refuses a taken name with mcp-server-exists', async () => {
    const { ctx, api, dispose } = await harness({ mcpDir: dir, profile: ['profiled'] })
    try {
      const spec = { serverName: 'fresh', transport: 'stdio' as const, command: 'echo', args: [], env: {}, cwd: '' }
      expect(expectOk(await api.mcp.add(request({ spec })))).toEqual({ serverName: 'fresh' })
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__fresh__remote')).toBeDefined()
      })

      // Taken by a user-managed instance.
      const takenUser = expectErr(await api.mcp.add(request({ spec: { ...spec, serverName: 'fresh' } })))
      expect(takenUser.code).toBe('mcp-server-exists')
      expect(takenUser.details).toEqual({ serverName: 'fresh' })
      // Taken by a profile-declared instance.
      const takenProfile = expectErr(await api.mcp.add(request({ spec: { ...spec, serverName: 'profiled' } })))
      expect(takenProfile.code).toBe('mcp-server-exists')
      expect(takenProfile.details).toEqual({ serverName: 'profiled' })
    } finally {
      await dispose()
    }
  })

  it('removes a user server and refuses a profile server with mcp-server-not-managed', async () => {
    const { ctx, api, dispose } = await harness({ mcpDir: dir, profile: ['profiled'] })
    try {
      await ctx.mcpManager.add({ serverName: 'fresh', transport: 'stdio', command: 'echo', args: [], env: {}, cwd: '' })
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__fresh__remote')).toBeDefined()
      })

      expect(expectErr(await api.mcp.remove(request({ serverName: 'profiled' }))).code).toBe('mcp-server-not-managed')
      expect(ctx.tools.get('mcp__fresh__remote')).toBeDefined()

      expect(expectOk(await api.mcp.remove(request({ serverName: 'fresh' })))).toEqual({})
      expect(ctx.tools.get('mcp__fresh__remote')).toBeUndefined()
      // A second remove is not managed anymore.
      expect(expectErr(await api.mcp.remove(request({ serverName: 'fresh' }))).code).toBe('mcp-server-not-managed')
    } finally {
      await dispose()
    }
  })

  it('reconnects any reported server and answers mcp-server-not-found otherwise', async () => {
    const { ctx, api, dispose } = await harness({ mcpDir: dir, profile: ['profiled'] })
    try {
      await ctx.mcpManager.add({ serverName: 'fresh', transport: 'stdio', command: 'echo', args: [], env: {}, cwd: '' })
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__fresh__remote')).toBeDefined()
      })

      expect(expectOk(await api.mcp.reconnect(request({ serverName: 'profiled' })))).toEqual({})
      expect(expectOk(await api.mcp.reconnect(request({ serverName: 'fresh' })))).toEqual({})
      const missing = expectErr(await api.mcp.reconnect(request({ serverName: 'ghost' })))
      expect(missing.code).toBe('mcp-server-not-found')
      expect(missing.details).toEqual({ serverName: 'ghost' })
    } finally {
      await dispose()
    }
  })

  it('answers mcp-manager-unavailable for the lifecycle without a manager, but still lists', async () => {
    const { api, dispose } = await harness({ mcpDir: dir, profile: ['profiled'], manager: false })
    try {
      const spec = { serverName: 'fresh', transport: 'stdio' as const, command: 'echo', args: [], env: {}, cwd: '' }
      expect(expectErr(await api.mcp.add(request({ spec }))).code).toBe('mcp-manager-unavailable')
      expect(expectErr(await api.mcp.remove(request({ serverName: 'profiled' }))).code).toBe('mcp-manager-unavailable')
      expect(expectErr(await api.mcp.reconnect(request({ serverName: 'profiled' }))).code).toBe('mcp-manager-unavailable')
      // list still serves the profile view, all rows unmanaged.
      const value = expectOk(await api.mcp.list(request({})))
      expect(value.servers).toEqual([
        { serverName: 'profiled', status: 'connected', managed: false, tools: [{ name: 'mcp__profiled__ping', description: 'Ping' }] },
      ])
    } finally {
      await dispose()
    }
  })
})
