/**
 * Tests for the mcp-client credential-reference seam: `{$cred: REF}` env and
 * header values resolve through the optional credentials and oauth-tokens
 * services at every connection attempt, so a stored or refreshed value
 * reaches the next attempt without a restart. Isolated file so the vi.mock of
 * the MCP SDK doesn't pollute other test suites.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CredentialProvider, type CredentialRef, type CredentialInfo, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import type { OAuthTokenBundle } from '@deepseek-ai/dsh-credentials-oauth-tokens'
import type { Config, ServerValue } from '@deepseek-ai/dsh-mcp-client'

// vi.mock factories are hoisted above every import/const, so the mock fns and
// class must be created inside vi.hoisted to exist when the factories run.
const { MockClient, mockClose, instances, mockListTools } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  const mockRequest = vi.fn(async (
    request: { method: string; params?: Record<string, unknown> },
    _schema: unknown,
    _options?: unknown,
  ): Promise<unknown> => {
    if (request.method === 'tools/list') return mockListTools(request.params)
    throw new Error(`unexpected MCP request: ${request.method}`)
  })
  class MockClient {
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    request = mockRequest
    setNotificationHandler = vi.fn()
    constructor() { instances.push(this) }
  }
  const instances: MockClient[] = []
  return { MockClient, mockClose, instances, mockListTools }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}))

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolveServerValues } from '@deepseek-ai/dsh-mcp-client/src/credentials.ts'
import { resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'

// ---- Fakes over the two optional services ----

/** A credentials service seeded with one value per reference. */
function fakeCredentials(
  values: Record<string, string>,
): { plugin: new (ctx: Context) => CredentialProvider; set: (ref: string, value: string) => void } {
  const store = new Map(Object.entries(values))
  const plugin = class TestCredentials extends CredentialProvider {
    resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
      const value = store.get(ref)
      return Promise.resolve(value === undefined ? undefined : { value, source: 'test' })
    }

    describe(_ref: CredentialRef): Promise<CredentialInfo> {
      throw new Error('unused in this spec')
    }

    async set(ref: CredentialRef, value: string): Promise<void> {
      store.set(ref, value)
    }

    async unset(ref: CredentialRef): Promise<void> {
      store.delete(ref)
    }
  }
  return { plugin, set: (ref, value) => { store.set(ref, value) } }
}

/** A token store seeded with one bundle per owner id, registered as `oauthTokens`. */
function fakeOauthTokens(bundles: Record<string, OAuthTokenBundle>): new (ctx: Context) => Service {
  const plugin = class TestOauthTokens extends Service {
    constructor(ctx: Context) {
      super(ctx, 'oauthTokens')
    }

    get(ownerId: string): OAuthTokenBundle | undefined {
      return bundles[ownerId]
    }
  }
  return plugin
}

function bundle(accessToken: string): OAuthTokenBundle {
  return {
    accessToken,
    expiresAt: Date.now() + 60_000,
    tokenEndpoint: 'https://provider.example/token',
    createdAt: 0,
    updatedAt: 0,
  }
}

function stdioConfig(env: Record<string, ServerValue>): Config {
  return {
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env,
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

function httpConfig(headers: Record<string, ServerValue>): Config {
  return {
    transport: 'streamable-http',
    serverName: 'srv',
    url: 'http://localhost:3000/mcp',
    headers,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

function sleep(ms: number): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

// ---- resolveServerValues ----

describe('resolveServerValues', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = new Context()
  })

  it('passes literal values through unchanged', async () => {
    const stdio = await resolveServerValues(ctx, stdioConfig({ LITERAL: 'value' }))
    expect(stdio.transport).toBe('stdio')
    if (stdio.transport === 'stdio') expect(stdio.env).toEqual({ LITERAL: 'value' })
    const http = await resolveServerValues(ctx, httpConfig({ X: 'literal' }))
    if (http.transport === 'streamable-http') expect(http.headers).toEqual({ X: 'literal' })
  })

  it('resolves a stdio env reference through the credentials service', async () => {
    const { plugin } = fakeCredentials({ NOTION_TOKEN: 'secret-123' })
    await ctx.plugin(plugin)
    const resolved = await resolveServerValues(ctx, stdioConfig({ NOTION_TOKEN: { $cred: 'NOTION_TOKEN' } }))
    if (resolved.transport === 'stdio') expect(resolved.env).toEqual({ NOTION_TOKEN: 'secret-123' })
  })

  it('resolves an http header reference through the credentials service', async () => {
    const { plugin } = fakeCredentials({ GITHUB_TOKEN: 'gh-token' })
    await ctx.plugin(plugin)
    const resolved = await resolveServerValues(ctx, httpConfig({ Authorization: { $cred: 'GITHUB_TOKEN' } }))
    if (resolved.transport === 'streamable-http') expect(resolved.headers).toEqual({ Authorization: 'gh-token' })
  })

  it('presents an oauth bundle as a Bearer value when the credentials store has no reference', async () => {
    await ctx.plugin(fakeOauthTokens({ google: bundle('oa-access') }))
    const resolved = await resolveServerValues(ctx, httpConfig({ Authorization: { $cred: 'google' } }))
    if (resolved.transport === 'streamable-http') expect(resolved.headers).toEqual({ Authorization: 'Bearer oa-access' })
  })

  it('lets a stored credential value win over an oauth bundle for the same reference', async () => {
    const { plugin } = fakeCredentials({ google: 'raw-credential' })
    await ctx.plugin(plugin)
    await ctx.plugin(fakeOauthTokens({ google: bundle('oa-access') }))
    const resolved = await resolveServerValues(ctx, stdioConfig({ GOO: { $cred: 'google' } }))
    if (resolved.transport === 'stdio') expect(resolved.env).toEqual({ GOO: 'raw-credential' })
  })

  it('skips the credentials store for a non-identifier reference and reaches the oauth store', async () => {
    await ctx.plugin(fakeOauthTokens({ 'my-connector': bundle('custom-access') }))
    const resolved = await resolveServerValues(ctx, stdioConfig({ T: { $cred: 'my-connector' } }))
    if (resolved.transport === 'stdio') expect(resolved.env).toEqual({ T: 'Bearer custom-access' })
  })

  it('fails when neither store has a value for the reference', async () => {
    const { plugin } = fakeCredentials({})
    await ctx.plugin(plugin)
    await expect(resolveServerValues(ctx, stdioConfig({ T: { $cred: 'ABSENT_REF' } })))
      .rejects.toThrow('mcp-client(srv): no stored value for credential reference "ABSENT_REF"')
  })

  it('fails for a reference when no service is composed', async () => {
    await expect(resolveServerValues(ctx, stdioConfig({ T: { $cred: 'ABSENT_REF' } })))
      .rejects.toThrow('no stored value for credential reference "ABSENT_REF"')
  })
})

// ---- supervisor re-resolution per attempt ----

describe('connection attempts re-resolve credential references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    instances.length = 0
    mockListTools.mockImplementation(async () => ({ tools: [], nextCursor: undefined }))
    // The real SDK's close() fires onclose; mirror it so disposal quiesces.
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
  })

  it('picks up a changed credential on the next attempt without a restart', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const { plugin, set } = fakeCredentials({ SRV_TOKEN: 'v1' })
    await ctx.plugin(plugin)

    const policy = resolveReconnectPolicy({ enabled: true, initialDelayMs: 10, maxDelayMs: 20, maxAttempts: 5 }, 'test')
    const connection = startConnection(ctx, stdioConfig({ TOKEN: { $cred: 'SRV_TOKEN' } }), policy)
    await connection.ready

    const firstEnv = vi.mocked(StdioClientTransport).mock.calls[0]?.[0]?.env as Record<string, string>
    expect(firstEnv.TOKEN).toBe('v1')

    // The generation goes down, the supervisor schedules a retry, and the
    // fresh attempt must read the changed value.
    instances[0]?.onclose?.()
    set('SRV_TOKEN', 'v2')
    await sleep(100)

    const secondEnv = vi.mocked(StdioClientTransport).mock.calls[1]?.[0]?.env as Record<string, string>
    expect(secondEnv.TOKEN).toBe('v2')
    await connection.dispose()
  })

  it('fails the startup attempt when the reference is unconfigured', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const { plugin } = fakeCredentials({})
    await ctx.plugin(plugin)

    const policy = resolveReconnectPolicy({ enabled: false }, 'test')
    const connection = startConnection(ctx, stdioConfig({ TOKEN: { $cred: 'MISSING' } }), policy)
    const outcome = await connection.ready
    expect(String(outcome.error)).toContain('no stored value for credential reference "MISSING"')
    await connection.dispose()
  })
})
