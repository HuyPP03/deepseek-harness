import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import { stringify } from 'yaml'

// The real mcp-client (workspace source) mounts below the manager; mock only
// the MCP SDK so no process spawns or network is touched.
const { MockClient, instances } = vi.hoisted(() => {
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
    constructor() { instances.push(this) }
  }
  const instances: MockClient[] = []
  return { MockClient, instances }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }))

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

beforeEach(() => {
  vi.clearAllMocks()
  instances.length = 0
})

describe('mcp-manager real Loader composition', () => {
  it('boots persisted user servers, adds, reconnects, and removes them while keeping profile servers intact', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-mcp-manager-loader-'))
    const mcpDir = join(root, '.mcp')
    const configPath = join(root, 'cordis.yml')
    await mkdir(mcpDir, { recursive: true })
    // A user server persisted from a previous run.
    await writeFile(join(mcpDir, 'persisted.cordis.yml'), stringify(
      [{ id: 'mcp-client-persisted', name: '@deepseek-ai/dsh-mcp-client', config: {
        serverName: 'persisted',
        transport: 'stdio',
        command: 'echo',
        args: [],
        env: {},
        cwd: '',
      } }],
      { lineWidth: 0 },
    ))
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-mcp-registry'",
      "- name: '@deepseek-ai/dsh-mcp-manager'",
      '  config:',
      '    mcpDir: ' + JSON.stringify(mcpDir),
      "- name: 'test:stub-profile-server'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-mcp-registry', McpRegistry],
      ['@deepseek-ai/dsh-mcp-manager', McpManager],
      // A stand-in for a profile-declared mcp-client instance.
      ['test:stub-profile-server', {
        name: 'stub-profile-server',
        inject: ['mcpRegistry'],
        apply(ctx: Context): void {
          ctx.effect(() => ctx.mcpRegistry.report('profiled', {
            read: () => ({
              serverName: 'profiled',
              status: 'connected',
              tools: [{ name: 'mcp__profiled__ping', description: 'Ping' }],
            }),
          }), 'stub-profile-server lifecycle')
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

    // The persisted server mounted at boot; the profile stub reports too.
    expect(context.tools.get('mcp__persisted__remote')).toBeDefined()
    expect(context.mcpManager.userServers()).toEqual(['persisted'])
    expect(context.mcpManager.servers()).toEqual([
      { serverName: 'persisted', status: 'connected', tools: [{ name: 'mcp__persisted__remote', description: '' }] },
      { serverName: 'profiled', status: 'connected', tools: [{ name: 'mcp__profiled__ping', description: 'Ping' }] },
    ])

    // Add a fresh user server at runtime.
    await context.mcpManager.add({ serverName: 'fresh', transport: 'stdio', command: 'echo', args: [], env: {}, cwd: '' })
    expect(context.tools.get('mcp__fresh__remote')).toBeDefined()
    const document = await readFile(join(mcpDir, 'fresh.cordis.yml'), 'utf8')
    expect(document).toContain('name: "@deepseek-ai/dsh-mcp-client"')
    expect(document).toContain('serverName: fresh')

    // Reconnect flows to the live instance through the registry.
    await context.mcpManager.reconnect('fresh')
    expect(context.mcpManager.servers().find(view => view.serverName === 'fresh')?.status).toBe('connected')

    // Remove the user server; the profile server is not removable.
    await context.mcpManager.remove('fresh')
    expect(context.tools.get('mcp__fresh__remote')).toBeUndefined()
    await expect(readFile(join(mcpDir, 'fresh.cordis.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
    await expect(context.mcpManager.remove('profiled')).rejects.toThrow(/not a user-managed server/)
    expect(context.mcpManager.servers().map(view => view.serverName)).toEqual(['persisted', 'profiled'])

    // The boot-mounted user server stays removable.
    await context.mcpManager.remove('persisted')
    expect(context.tools.get('mcp__persisted__remote')).toBeUndefined()
    await expect(readFile(join(mcpDir, 'persisted.cordis.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
    expect(context.mcpManager.servers()).toEqual([
      { serverName: 'profiled', status: 'connected', tools: [{ name: 'mcp__profiled__ping', description: 'Ping' }] },
    ])
  })
})
