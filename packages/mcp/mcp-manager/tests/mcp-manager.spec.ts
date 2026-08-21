/**
 * Tests for the mcp-manager service: startup loading of persisted user
 * servers, add/remove lifecycle, registry pass-through, and teardown. The MCP
 * SDK is mocked so mounted mcp-client instances never spawn a process.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import McpManager, { resolveConfig } from '@deepseek-ai/dsh-mcp-manager'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

// ---- Mock MCP SDK ----

const { mockConnect, mockClose, mockListTools, mockCallTool, MockClient, instances } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  const mockCallTool = vi.fn<(_params?: Record<string, unknown>, _schema?: unknown, _options?: unknown) => Promise<unknown>>()
  const mockRequest = vi.fn(async (
    request: { method: string; params?: Record<string, unknown> },
    _schema: unknown,
    options?: unknown,
  ): Promise<unknown> => {
    if (request.method === 'tools/list') return await mockListTools(request.params)
    if (request.method === 'tools/call') return await mockCallTool(request.params, undefined, options)
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
  return { mockConnect, mockClose, mockListTools, mockCallTool, MockClient, instances }
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

import { stringify } from 'yaml'

// ---- Helpers ----

function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[]; nextCursor: undefined } {
  return {
    tools: names.map(name => ({ name, inputSchema: { type: 'object' } })),
    nextCursor: undefined,
  }
}

const STDIO_SPEC = {
  serverName: 'mine',
  transport: 'stdio' as const,
  command: 'echo',
  args: [],
  env: {},
  cwd: '',
}

// The sparse forms: the config translator's defaults (args/env/cwd/timeout
// absence) are only observable through the mounted instance's config.
const SPARSE_STDIO_SPEC = {
  serverName: 'sparse',
  transport: 'stdio' as const,
  command: 'echo',
}
const SPARSE_HTTP_SPEC = {
  serverName: 'sparse-http',
  transport: 'streamable-http' as const,
  url: 'http://127.0.0.1:1/mcp',
}

const HTTP_SPEC = {
  serverName: 'http',
  transport: 'streamable-http' as const,
  url: 'http://127.0.0.1:1/mcp',
  headers: {},
}

async function mountHarness(dir: string): Promise<{ ctx: Context; managerFiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpRegistry)
  const managerFiber = await ctx.plugin(McpManager, { mcpDir: dir })
  return { ctx, managerFiber }
}

describe('mcp-manager', () => {
  let dir: string
  let ctx: Context
  let managerFiber: Awaited<ReturnType<Context['plugin']>> | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue(listing('remote'))
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-manager-'))
  })

  afterEach(async () => {
    if (managerFiber !== undefined) await managerFiber.dispose()
    managerFiber = undefined
    await rm(dir, { recursive: true, force: true })
  })

  it('starts with no servers and an empty registry', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    expect(ctx.mcpManager.servers()).toEqual([])
    expect(ctx.mcpManager.userServers()).toEqual([])
  })

  it('boots an empty roster when the server directory does not exist yet', async () => {
    await rm(dir, { recursive: true, force: true })
    const mounted = await mountHarness(dir)
    ctx = mounted.ctx
    managerFiber = mounted.managerFiber
    expect(ctx.mcpManager.servers()).toEqual([])
    expect(ctx.mcpManager.userServers()).toEqual([])
  })

  it('fails the boot loud when the server directory is unreadable', async () => {
    await rm(dir, { recursive: true, force: true })
    await writeFile(dir, 'not a directory')
    await expect(mountHarness(dir)).rejects.toThrow(/ENOTDIR/)
    ctx = undefined as unknown as Context
  })

  it('mounts persisted servers at startup and serves their tools', async () => {
    await writeFile(join(dir, 'mine.cordis.yml'), stringify([
      { id: 'mcp-client-mine', name: '@deepseek-ai/dsh-mcp-client', config: STDIO_SPEC },
    ], { lineWidth: 0 }))
    void mockListTools.mockResolvedValue(listing('booted'))

    ({ ctx, managerFiber } = await mountHarness(dir))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__mine__booted')).toBeDefined() })
    expect(ctx.mcpManager.userServers()).toEqual(['mine'])
    expect(ctx.mcpManager.servers()).toEqual([
      { serverName: 'mine', status: 'connected', tools: [{ name: 'mcp__mine__booted', description: '' }] },
    ])
  })

  it('fails the boot loud on an unparsable persisted server', async () => {
    await writeFile(join(dir, 'bad.cordis.yml'), 'not: [valid')
    await expect(mountHarness(dir)).rejects.toThrow(/not valid YAML/)
    ctx = undefined as unknown as Context
  })

  it('fails the boot loud on a persisted file naming a foreign plugin', async () => {
    await writeFile(join(dir, 'bad.cordis.yml'), stringify([
      { id: 'x', name: '@deepseek-ai/dsh-commands', config: {} },
    ], { lineWidth: 0 }))
    await expect(mountHarness(dir)).rejects.toThrow(/must hold a single @deepseek-ai\/dsh-mcp-client entry/)
    ctx = undefined as unknown as Context
  })

  it('fails the boot loud on a persisted document that is not an entry list', async () => {
    await writeFile(join(dir, 'bad.cordis.yml'), stringify({ id: 'x', name: 'y' }, { lineWidth: 0 }))
    await expect(mountHarness(dir)).rejects.toThrow(/must hold one entry list/)
    ctx = undefined as unknown as Context
  })

  it('fails the boot loud on a persisted document holding an empty entry list', async () => {
    await writeFile(join(dir, 'bad.cordis.yml'), stringify([], { lineWidth: 0 }))
    await expect(mountHarness(dir)).rejects.toThrow(/must hold one entry list/)
    ctx = undefined as unknown as Context
  })

  it('adds a user server: persists the document and mounts the instance', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))

    await ctx.mcpManager.add(HTTP_SPEC)
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__http__remote')).toBeDefined() })

    const raw = await (await import('node:fs/promises')).readFile(join(dir, 'http.cordis.yml'), 'utf8')
    expect(raw).toContain('name: "@deepseek-ai/dsh-mcp-client"')
    expect(raw).toContain('url: http://127.0.0.1:1/mcp')
    expect(ctx.mcpManager.userServers()).toEqual(['http'])
    expect(ctx.mcpManager.servers()[0]).toEqual({
      serverName: 'http',
      status: 'connected',
      tools: [{ name: 'mcp__http__remote', description: '' }],
    })
  })

  it('translates sparse specs through the config defaults before mounting', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    const { DEFAULT_TOOL_CALL_TIMEOUT_MS } = await import('@deepseek-ai/dsh-mcp-client')
    const realPlugin = ctx.plugin.bind(ctx)
    const clientConfigs: unknown[] = []
    const pluginSpy = vi.spyOn(ctx, 'plugin').mockImplementation(((...args: unknown[]) => {
      if ((args[0] as { name?: unknown } | undefined)?.name === 'mcp-client') clientConfigs.push(args[1])
      return (realPlugin as (...a: unknown[]) => unknown)(...args)
    }) as never)
    try {
      await ctx.mcpManager.add(SPARSE_STDIO_SPEC)
      await ctx.mcpManager.add(SPARSE_HTTP_SPEC)
      await vi.waitFor(() => { expect(ctx.tools.get('mcp__sparse__remote')).toBeDefined() })
      await vi.waitFor(() => { expect(ctx.tools.get('mcp__sparse-http__remote')).toBeDefined() })
      // Sparse user specs mount with the translator's defaults filled in.
      expect(clientConfigs).toEqual([
        {
          transport: 'stdio', serverName: 'sparse', command: 'echo',
          args: [], env: {}, cwd: '', toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
          failOnStartupError: false,
        },
        {
          transport: 'streamable-http', serverName: 'sparse-http',
          url: 'http://127.0.0.1:1/mcp', headers: {},
          toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS, failOnStartupError: false,
        },
      ])
    } finally {
      pluginSpy.mockRestore()
    }
  })

  it('refuses to add a server whose name is already managed', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    await ctx.mcpManager.add(STDIO_SPEC)
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__mine__remote')).toBeDefined() })

    await expect(ctx.mcpManager.add(STDIO_SPEC)).rejects.toThrow(/already managed/)
  })

  it('refuses to add a server whose name another instance already reports', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    // A stand-in for a profile-declared mcp-client instance.
    ctx.effect(() => ctx.mcpRegistry.report('mine', { read: () => ({
      serverName: 'mine',
      status: 'connected',
      tools: [],
    }) }), 'stub profile reporter')

    await expect(ctx.mcpManager.add(STDIO_SPEC)).rejects.toThrow(/already reported by another mcp-client instance/)
    // No file was written for the refused add.
    expect(ctx.mcpManager.userServers()).toEqual([])
  })

  it('deletes the document when the add mount fails', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    // Reserve the namespace the way a concurrent instance would: mount one,
    // then refuse the duplicate at mcp-client's own reservation.
    await ctx.mcpManager.add(STDIO_SPEC)
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__mine__remote')).toBeDefined() })

    await expect(ctx.mcpManager.add(STDIO_SPEC)).rejects.toThrow(/already managed/)
    // A real mount failure: a serverName the mcp-client schema rejects (the
    // public pattern allows only [A-Za-z0-9_-]). The fiber rejects at
    // resolution, and the manager must roll its own document back.
    const failing = { ...STDIO_SPEC, serverName: 'a.b' }
    await expect(ctx.mcpManager.add(failing)).rejects.toThrow(/mounting user server "a.b" failed/)
    // The failed add left no document behind.
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(dir, 'a.b.cordis.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('removes a user server: disposes the instance and deletes the file', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    await ctx.mcpManager.add(STDIO_SPEC)
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__mine__remote')).toBeDefined() })

    await ctx.mcpManager.remove('mine')
    expect(ctx.tools.get('mcp__mine__remote')).toBeUndefined()
    expect(ctx.mcpManager.userServers()).toEqual([])
    expect(ctx.mcpManager.servers()).toEqual([])
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(dir, 'mine.cordis.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('refuses to remove a server it does not manage', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    await expect(ctx.mcpManager.remove('ghost')).rejects.toThrow(/not a user-managed server/)
  })

  it('forwards reconnect to the registry and surfaces the new state', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    await ctx.mcpManager.add(STDIO_SPEC)
    await vi.waitFor(() => { expect(ctx.mcpManager.servers()[0]?.status).toBe('connected') })

    await expect(ctx.mcpManager.reconnect('missing')).rejects.toThrow(/is not reported/)
    await ctx.mcpManager.reconnect('mine')
    await vi.waitFor(() => { expect(ctx.mcpManager.servers()[0]?.status).toBe('connected') })
  })

  it('tears every mounted user server down with the service fiber', async () => {
    ({ ctx, managerFiber } = await mountHarness(dir))
    await ctx.mcpManager.add(STDIO_SPEC)
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__mine__remote')).toBeDefined() })

    await managerFiber?.dispose()
    expect(ctx.tools.get('mcp__mine__remote')).toBeUndefined()
    // The document survives: user state outlives the process.
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(dir, 'mine.cordis.yml'), 'utf8')).resolves.toContain('mcp-client-mine')
  })
})

describe('resolveConfig', () => {
  it('resolves an explicit mcpDir and expands the home', () => {
    expect(resolveConfig({ mcpDir: join(tmpdir(), 'mcp') }).mcpDir).toBe(join(tmpdir(), 'mcp'))
    expect(resolveConfig({ mcpDir: '~/mcp' }).mcpDir).toBe(join(process.env.HOME ?? '~', 'mcp'))
  })

  it('falls back to the harness home when mcpDir is omitted', () => {
    expect(resolveConfig({}).mcpDir).toBe(dshHomePath('.mcp'))
  })
})
