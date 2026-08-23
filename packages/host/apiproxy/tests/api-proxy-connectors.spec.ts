/**
 * connector RPC domain over createApiProxy: the secret-free list, the
 * configure/connect/complete/disconnect lifecycle with its stable error
 * codes, the custom add/remove, the seam-unavailable reports, and the
 * optional-composition fallback when a deployment mounts no connectors
 * service. The composition boots through the real Loader; only the MCP
 * SDK is mocked, so no process spawns and no network is touched.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import OAuthTokenStore from '@deepseek-ai/dsh-credentials-oauth-tokens'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Connectors from '@deepseek-ai/dsh-connectors'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import type { ApiProxy } from '../src/api/index.ts'
import type { RpcResponse } from '../src/api/rpc.ts'

// The manager mounts real mcp-client instances; mock only the MCP SDK.
const { MockClient } = vi.hoisted(() => {
  class MockClient {
    onclose: (() => void) | undefined
    connect = vi.fn(async () => {})
    close = vi.fn(async function (this: { onclose?: () => void }) { this.onclose?.() })
    request = vi.fn(async (request: { method: string }) => {
      if (request.method === 'tools/list') return { tools: [{ name: 'remote', inputSchema: { type: 'object' } }], nextCursor: undefined }
      throw new Error(`unexpected MCP request: ${request.method}`)
    })
    setNotificationHandler = vi.fn()
  }
  return { MockClient }
})
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
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

// A token connector whose server needs both a stored credential and a
// configured override field: the two slot failure modes on one manifest.
const DUO_YML = [
  'id: duo',
  'name: Duo',
  'description: Token plus override.',
  'presetId: duo',
  'workspaceDirName: duo',
  'auth:',
  '  - mode: token',
  '    credentialRefs:',
  '      - DUO_TOKEN',
  'servers:',
  '  - serverName: duo',
  '    transport: stdio',
  '    command: node',
  '    args: [fixture]',
  '    env:',
  '      DUO_KEY: { $cred: DUO_TOKEN }',
  '      DUO_URL: { $override: url }',
  '',
].join('\n')

const DEFAULTS = { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectErr(response: RpcResponse<unknown>): { code: string; message: string; details: Record<string, unknown> } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return { code: response.result.error.code, message: response.result.error.message, details: response.result.error.details }
}

type HarnessOptions = {
  /** Mount the connectors service; false composes a deployment without the surface. */
  connectors?: boolean
  /** Mount the credentials seam; false lets the store-and-connect halves report seam-unavailable. */
  credentials?: boolean
  /** Mount the agent-presets seam; false lets addCustom report seam-unavailable. */
  presets?: boolean
}

/** Boot one real composition and wrap it with the RPC surface plus an in-process client. */
async function harness(options: HarnessOptions = {}): Promise<{
  client: InProcessApiClient
  root: string
  home: string
  dispose: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-api-connectors-'))
  const home = await mkdtemp(join(tmpdir(), 'dsh-api-connectors-home-'))
  vi.stubEnv('DSH_HOME', home)
  const mcpDir = join(root, '.mcp')
  const catalogDir = join(root, 'catalog')
  const userDir = join(root, 'user')
  const systemPresets = join(root, 'presets')
  await mkdir(mcpDir, { recursive: true })
  await mkdir(catalogDir, { recursive: true })
  await writeFile(join(catalogDir, 'notion.yml'), NOTION_YML)
  await writeFile(join(catalogDir, 'google.yml'), GOOGLE_YML)
  await writeFile(join(catalogDir, 'duo.yml'), DUO_YML)
  await mkdir(join(systemPresets, 'custom'), { recursive: true })
  await writeFile(join(systemPresets, 'custom', 'agent.cordis.yml'), '- id: stub\n  name: test:stub-preset\n')

  const lines: string[] = [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    '  config:',
    "    persona: ''",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-user-questions'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-mcp-registry'",
    "- name: '@deepseek-ai/dsh-mcp-manager'",
    '  config:',
    `    mcpDir: ${JSON.stringify(mcpDir)}`,
  ]
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-user-questions', UserQuestionService],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-mcp-registry', McpRegistry],
    ['@deepseek-ai/dsh-mcp-manager', McpManager],
  ])
  if (options.credentials !== false) {
    lines.push(
      "- name: '@deepseek-ai/dsh-credentials-local'",
      '  config:',
      `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
      '    watch: false',
    )
    modules.set('@deepseek-ai/dsh-credentials-local', LocalCredentialProvider)
  }
  lines.push(
    "- name: '@deepseek-ai/dsh-credentials-oauth-tokens'",
    '  config:',
    `    path: ${JSON.stringify(join(home, 'tokens.json'))}`,
    '    watch: false',
  )
  modules.set('@deepseek-ai/dsh-credentials-oauth-tokens', OAuthTokenStore)
  if (options.presets !== false) {
    lines.push(
      "- name: '@deepseek-ai/dsh-agent-presets'",
      '  config:',
      '    default: custom',
      '    roots:',
      `      - path: ${JSON.stringify(systemPresets)}`,
      '        trust: system',
      '    includeUserRoot: true',
    )
    modules.set('@deepseek-ai/dsh-agent-presets', AgentPresets)
  }
  if (options.connectors !== false) {
    lines.push(
      "- name: '@deepseek-ai/dsh-connectors'",
      '  config:',
      `    catalogDir: ${JSON.stringify(catalogDir)}`,
      `    userDir: ${JSON.stringify(userDir)}`,
    )
    modules.set('@deepseek-ai/dsh-connectors', Connectors)
  }
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, `${lines.join('\n')}\n`)

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  const api: ApiProxy = createApiProxy(ctx, DEFAULTS)
  const client = new InProcessApiClient(toFetchHandler(api))
  return { client, root, home, dispose: () => ctx.fiber.dispose() }
}

let root: string | undefined
let home: string | undefined

afterEach(async () => {
  for (const dir of [root, home]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
  root = undefined
  home = undefined
  vi.unstubAllEnvs()
})

describe('connector RPC domain', () => {
  it('lists the roster as secret-free views', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const value = expectOk(await client.connectors.list({}))
      expect(value.connectors.map(view => view.id)).toEqual(['duo', 'google', 'notion'])
      for (const view of value.connectors) {
        expect(view.state).toBe('unconfigured')
        expect(view.custom).toBe(false)
      }
      // The wire view carries no server command, URL, or credential field.
      const wire = JSON.stringify(value)
      expect(wire).not.toContain('fixture')
      expect(wire).not.toContain('gmailmcp.googleapis.com')
      expect(wire).not.toContain('NOTION_API_TOKEN')
    } finally {
      await dispose()
    }
  })

  it('stores a token through configure, mounts the servers, and returns the updated view', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const value = expectOk(await client.connectors.configure({ id: 'notion', fields: { token: 'shipped-token' } }))
      expect(value.connector.id).toBe('notion')
      expect(value.connector.state).toBe('connected')
      expect(value.connector.servers).toEqual([{ serverName: 'notion', mounted: true, status: 'connected' }])
      expect(value.connector.auth).toEqual([{ mode: 'token', configured: true }])
      const credDoc = await readFile(join(root, '.credentials.yaml'), 'utf8')
      expect(credDoc).toContain('NOTION_API_TOKEN')
    } finally {
      await dispose()
    }
  })

  it('reports connector-not-found for an unknown id on the mutating verbs', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const missing = (response: RpcResponse<unknown>) => {
        const error = expectErr(response)
        expect(error.code).toBe('connector-not-found')
        expect(error.details).toEqual({ id: 'ghost' })
      }
      missing(await client.connectors.configure({ id: 'ghost', fields: {} }))
      missing(await client.connectors.connect({ id: 'ghost', mode: 'token' }))
      missing(await client.connectors.complete({ id: 'ghost', token: 't' }))
      missing(await client.connectors.disconnect({ id: 'ghost' }))
      missing(await client.connectors.remove({ id: 'ghost' }))
    } finally {
      await dispose()
    }
  })

  it('maps plain operation rejections to internal', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      // google declares no token method; the service rejects with a plain Error.
      const configured = expectErr(await client.connectors.configure({ id: 'google', fields: { token: 't' } }))
      expect(configured.code).toBe('internal')
      expect(configured.message).toContain('supports no token auth')
      // a credential ref the token method does not declare
      const badRef = expectErr(await client.connectors.configure({ id: 'notion', fields: { credentials: { WRONG: 'x' } } }))
      expect(badRef.code).toBe('internal')
      expect(badRef.message).toContain('not a credential reference')
      // google declares no token mode to connect through
      const connected = expectErr(await client.connectors.connect({ id: 'google', mode: 'token' }))
      expect(connected.code).toBe('internal')
      expect(connected.message).toContain('supports no token auth')
      // a stdio custom without a command
      const added = expectErr(await client.connectors.add({ spec: { name: 'Broken', transport: 'stdio' } }))
      expect(added.code).toBe('internal')
      expect(added.message).toContain('needs a command')
    } finally {
      await dispose()
    }
  })

  it('refuses to connect a token connector whose credential is not stored', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const error = expectErr(await client.connectors.connect({ id: 'notion', mode: 'token' }))
      expect(error.code).toBe('connector-credential-missing')
      expect(error.details).toEqual({ id: 'notion', ref: 'NOTION_API_TOKEN' })
      expect(error.message).toContain('NOTION_API_TOKEN')
    } finally {
      await dispose()
    }
  })

  it('refuses oauth before its flow engine exists', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const error = expectErr(await client.connectors.connect({ id: 'google', mode: 'oauth' }))
      expect(error.code).toBe('connector-auth-unavailable')
      expect(error.details).toEqual({ id: 'google', mode: 'oauth' })
    } finally {
      await dispose()
    }
  })

  it('settles an auth with complete: the store-and-connect half', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const value = expectOk(await client.connectors.complete({ id: 'notion', token: 'flow-token' }))
      expect(value.connector.state).toBe('connected')
      expect(value.connector.servers).toEqual([{ serverName: 'notion', mounted: true, status: 'connected' }])
    } finally {
      await dispose()
    }
  })

  it('surfaces a missing override field as the connector error state, then recovers', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      // The credential is stored, but the url override was never configured:
      // the mount fails and the view carries the error state with its message.
      const configured = expectOk(await client.connectors.configure({ id: 'duo', fields: { token: 'duo-token' } }))
      expect(configured.connector.state).toBe('error')
      expect(configured.connector.lastError).toContain('needs its "url" field configured')
      const wireError = expectErr(await client.connectors.connect({ id: 'duo', mode: 'token' }))
      expect(wireError.code).toBe('connector-override-missing')
      expect(wireError.details).toEqual({ id: 'duo', field: 'url' })
      // The missing field is configured; the same connect now mounts.
      expectOk(await client.connectors.configure({ id: 'duo', fields: { url: 'https://duo.example/mcp' } }))
      const recovered = expectOk(await client.connectors.connect({ id: 'duo', mode: 'token' }))
      expect(recovered.connector.state).toBe('connected')
      expect(recovered.connector.lastError).toBeUndefined()
    } finally {
      await dispose()
    }
  })

  it('disconnects a connected connector back to unconfigured', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      expectOk(await client.connectors.configure({ id: 'notion', fields: { token: 'shipped-token' } }))
      const value = expectOk(await client.connectors.disconnect({ id: 'notion' }))
      expect(value.connector.state).toBe('unconfigured')
      expect(value.connector.servers).toEqual([{ serverName: 'notion', mounted: false }])
      const credDoc = await readFile(join(root, '.credentials.yaml'), 'utf8')
      expect(credDoc).not.toContain('shipped-token')
    } finally {
      await dispose()
    }
  })

  it('adds a no-auth custom connector, refuses a duplicate, and removes it', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const added = expectOk(await client.connectors.add({
        spec: { name: 'Local API', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' },
      }))
      expect(added.id).toBe('custom-local-api')
      const roster = expectOk(await client.connectors.list({}))
      const custom = roster.connectors.find(view => view.id === 'custom-local-api')
      expect(custom).toEqual(expect.objectContaining({ custom: true, state: 'connected' }))

      const exists = expectErr(await client.connectors.add({
        spec: { name: 'Local API', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' },
      }))
      expect(exists.code).toBe('connector-exists')
      expect(exists.details).toEqual({ id: 'custom-local-api' })

      const removed = expectOk(await client.connectors.remove({ id: 'custom-local-api' }))
      expect(removed).toEqual({})
      const after = expectOk(await client.connectors.list({}))
      expect(after.connectors.map(view => view.id)).toEqual(['duo', 'google', 'notion'])
    } finally {
      await dispose()
    }
  })

  it('refuses to remove a shipped connector', async () => {
    const { client, dispose, root: r, home: h } = await harness()
    root = r
    home = h
    try {
      const error = expectErr(await client.connectors.remove({ id: 'notion' }))
      expect(error.code).toBe('connector-not-custom')
      expect(error.details).toEqual({ id: 'notion' })
    } finally {
      await dispose()
    }
  })

  it('reports connector-unavailable when a seam this deployment does not compose is needed', async () => {
    const { client, dispose, root: r, home: h } = await harness({ credentials: false, presets: false })
    root = r
    home = h
    try {
      // Storing a token needs the credentials seam.
      const configured = expectErr(await client.connectors.configure({ id: 'notion', fields: { token: 't' } }))
      expect(configured.code).toBe('connector-unavailable')
      expect(configured.message).toContain('credentials')
      // Authoring a custom needs the agent-presets seam.
      const added = expectErr(await client.connectors.add({
        spec: { name: 'Local API', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' },
      }))
      expect(added.code).toBe('connector-unavailable')
      expect(added.message).toContain('agent-presets')
    } finally {
      await dispose()
    }
  })

  it('answers list with an empty roster and connector-unavailable for mutations when no connectors service is composed', async () => {
    const { client, dispose, root: r, home: h } = await harness({ connectors: false })
    root = r
    home = h
    try {
      expect(expectOk(await client.connectors.list({}))).toEqual({ connectors: [] })
      const unavailable = (response: RpcResponse<unknown>) => {
        const error = expectErr(response)
        expect(error.code).toBe('connector-unavailable')
      }
      unavailable(await client.connectors.configure({ id: 'notion', fields: {} }))
      unavailable(await client.connectors.connect({ id: 'notion', mode: 'token' }))
      unavailable(await client.connectors.complete({ id: 'notion', token: 't' }))
      unavailable(await client.connectors.disconnect({ id: 'notion' }))
      unavailable(await client.connectors.add({ spec: { name: 'Local API', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' } }))
      unavailable(await client.connectors.remove({ id: 'notion' }))
    } finally {
      await dispose()
    }
  })
})
