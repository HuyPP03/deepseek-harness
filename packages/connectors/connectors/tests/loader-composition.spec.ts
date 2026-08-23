/**
 * REAL composition test: the connector catalog booted from a test-only
 * cordis.yml through the Loader, with the real system-prompt, tools,
 * mcp-registry, mcp-manager, credentials-local, oauth-tokens, and
 * agent-presets services. Only the MCP SDK is mocked, so no process spawns
 * and no network is touched.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import OAuthTokenStore from '@deepseek-ai/dsh-credentials-oauth-tokens'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Connectors, { ConnectorAuthUnavailableError } from '../src/index.ts'

const sdk = vi.hoisted(() => {
  const control = { connectImpl: async (): Promise<void> => {} }
  class MockClient {
    onclose: (() => void) | undefined
    connect = vi.fn(async () => { await control.connectImpl() })
    close = vi.fn(async function (this: { onclose?: () => void }) { this.onclose?.() })
    request = vi.fn(async (request: { method: string }) => {
      if (request.method === 'tools/list') return { tools: [{ name: 'remote', inputSchema: { type: 'object' } }], nextCursor: undefined }
      throw new Error(`unexpected MCP request: ${request.method}`)
    })
    setNotificationHandler = vi.fn()
  }
  return { MockClient, control }
})
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: sdk.MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }))

const NOTION_YML = [
  'id: notion',
  'name: Notion',
  'description: Read and write Notion.',
  'presetId: notion',
  'workspaceDirName: notion',
  'auth:',
  '  - mode: token',
  '    credentialRefs:',
  '      - NOTION_API_TOKEN',
  'servers:',
  '  - serverName: notion',
  '    transport: stdio',
  '    command: node',
  '    args: [fixture]',
  '    env:',
  '      NOTION_API_KEY: { $cred: NOTION_API_TOKEN }',
  'suggestions:',
  '  - Summarize my workspace',
  '',
].join('\n')

const GOOGLE_YML = [
  'id: google',
  'name: Google Workspace',
  'description: Gmail and Drive.',
  'presetId: google',
  'workspaceDirName: google',
  'products: [gmail, drive]',
  'auth:',
  '  - mode: oauth',
  '    serverUrl: https://gmailmcp.googleapis.com/mcp/v1',
  '    byoApp: true',
  'servers:',
  '  - serverName: google-gmail',
  '    transport: streamable-http',
  '    url: https://gmailmcp.googleapis.com/mcp/v1',
  '',
].join('\n')

let root: string | undefined
let home: string | undefined
let context: Context | undefined

async function boot(catalogFiles: readonly [string, string][]): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'dsh-connectors-loader-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-connectors-home-'))
  vi.stubEnv('DSH_HOME', home)
  const mcpDir = join(root, '.mcp')
  const catalogDir = join(root, 'catalog')
  const userDir = join(root, 'user')
  const systemPresets = join(root, 'presets')
  await mkdir(mcpDir, { recursive: true })
  await mkdir(catalogDir, { recursive: true })
  for (const [name, text] of catalogFiles) await writeFile(join(catalogDir, name), text)
  await mkdir(join(systemPresets, 'custom'), { recursive: true })
  await writeFile(join(systemPresets, 'custom', 'agent.cordis.yml'), '- id: stub\n  name: test:stub-preset\n')

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-mcp-registry'",
    "- name: '@deepseek-ai/dsh-mcp-manager'",
    '  config:',
    '    mcpDir: ' + JSON.stringify(mcpDir),
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    '    path: ' + JSON.stringify(join(root, '.credentials.yaml')),
    '    watch: false',
    "- name: '@deepseek-ai/dsh-credentials-oauth-tokens'",
    '  config:',
    '    path: ' + JSON.stringify(join(root, 'tokens.json')),
    '    watch: false',
    "- name: '@deepseek-ai/dsh-agent-presets'",
    '  config:',
    '    default: custom',
    '    roots:',
    '      - path: ' + JSON.stringify(systemPresets),
    '        trust: system',
    '    includeUserRoot: true',
    "- name: '@deepseek-ai/dsh-connectors'",
    '  config:',
    '    catalogDir: ' + JSON.stringify(catalogDir),
    '    userDir: ' + JSON.stringify(userDir),
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
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-credentials-oauth-tokens', OAuthTokenStore],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-connectors', Connectors],
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

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const dir of [root, home]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
  root = undefined
  home = undefined
  vi.unstubAllEnvs()
  sdk.control.connectImpl = async () => {}
})

describe('connectors real Loader composition', () => {
  it('lists the catalog, auto-connects a token configure, and tears it down', async () => {
    await boot([['notion.yml', NOTION_YML], ['google.yml', GOOGLE_YML]])
    const ctx = context!

    const views = await ctx.connectors.list()
    expect(views.map(view => view.id)).toEqual(['google', 'notion'])
    for (const view of views) expect(view.state).toBe('unconfigured')
    expect(JSON.stringify(views)).not.toContain('fixture')
    expect(JSON.stringify(views)).not.toContain('gmailmcp.googleapis.com')

    const events: Array<[string, string]> = []
    ctx.on('connector/state', (id, state) => {
      events.push([id, state])
    })

    await ctx.connectors.configure('notion', { token: 'shipped-token' })
    expect(ctx.tools.get('mcp__notion__remote')).toBeDefined()
    expect((await ctx.connectors.get('notion'))?.state).toBe('connected')
    // P0a interim: the persisted server document carries the resolved literal.
    const serverDoc = await readFile(join(root!, '.mcp', 'notion.cordis.yml'), 'utf8')
    expect(serverDoc).toContain('shipped-token')
    const credDoc = await readFile(join(root!, '.credentials.yaml'), 'utf8')
    expect(credDoc).toContain('NOTION_API_TOKEN')
    expect(events).toEqual([['notion', 'connected']])

    await ctx.connectors.disconnect('notion')
    expect(ctx.tools.get('mcp__notion__remote')).toBeUndefined()
    expect((await ctx.connectors.get('notion'))?.state).toBe('unconfigured')
    expect(events).toEqual([['notion', 'connected'], ['notion', 'unconfigured']])
  })

  it('refuses oauth before its engine exists and tracks byoApp configuration', async () => {
    await boot([['notion.yml', NOTION_YML], ['google.yml', GOOGLE_YML]])
    const ctx = context!
    await expect(ctx.connectors.connect('google', 'oauth')).rejects.toThrow(ConnectorAuthUnavailableError)

    await ctx.connectors.configure('google', { clientId: 'abc.apps.googleusercontent.com', clientSecret: 'shh' })
    expect((await ctx.connectors.get('google'))?.state).toBe('needs-auth')
    const credDoc = await readFile(join(root!, '.credentials.yaml'), 'utf8')
    expect(credDoc).toContain('GOOGLE_OAUTH_CLIENT_SECRET')
  })

  it('adds a no-auth custom connector and removes it again', async () => {
    await boot([['notion.yml', NOTION_YML]])
    const ctx = context!
    const id = await ctx.connectors.addCustom({
      name: 'Local API',
      transport: 'streamable-http',
      url: 'http://127.0.0.1:9999/mcp',
    })
    expect(id).toBe('custom-local-api')
    expect(ctx.tools.get('mcp__custom-local-api__remote')).toBeDefined()
    expect((await ctx.connectors.get(id))?.state).toBe('connected')
    expect((await ctx.connectors.get(id))?.custom).toBe(true)
    await stat(join(home!, '.agent-presets', id, 'agent.cordis.yml'))

    await ctx.connectors.removeCustom(id)
    expect(ctx.tools.get('mcp__custom-local-api__remote')).toBeUndefined()
    expect(await ctx.connectors.get(id)).toBeUndefined()
    await expect(stat(join(home!, '.agent-presets', id))).rejects.toThrow(/ENOENT/)
  })

  it('fails the whole boot on a malformed catalog manifest', async () => {
    await expect(boot([['broken.yml', 'id: Bad Id\nname: X\ndescription: X\npresetId: x\nworkspaceDirName: x\nservers: []\nauth: []\n']]))
      .rejects.toThrow(/invalid manifest/)
  })
})
