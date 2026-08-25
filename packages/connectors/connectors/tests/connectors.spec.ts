/**
 * Service-level suite for the connector catalog and state machine: the real
 * mcp-registry, mcp-manager, credentials-local, oauth-tokens, and
 * agent-presets services, with the MCP SDK mocked so no process spawns and
 * no network is touched. The Loader-level composition lives in
 * loader-composition.spec.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import OAuthTokenStore from '@deepseek-ai/dsh-credentials-oauth-tokens'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Connectors, {
  ConnectorAuthPendingError,
  ConnectorAuthUnavailableError,
  ConnectorCredentialMissingError,
  ConnectorExistsError,
  ConnectorNotFoundError,
  ConnectorNotCustomError,
  ConnectorOverrideMissingError,
  ConnectorSeamUnavailableError,
  clientSecretRef,
} from '../src/index.ts'

const sdk = vi.hoisted(() => {
  const control = {
    connectImpl: async (): Promise<void> => {},
  }
  const flowControl = {
    ensureFreshImpl: async (): Promise<void> => {},
  }
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
  return { MockClient, control, flowControl }
})

/**
 * One test-only stand-in for the oauth-flow engine: records the ids its
 * refresh seam is asked to keep fresh, settling through the shared control
 * so a test can fail or gate a refresh.
 */
class FakeOAuthFlow extends Service {
  readonly ensured: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'oauthFlow')
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield () => {}
  }

  async begin(_id: string): Promise<{ authorizationUrl: string; expiresAt: number }> {
    throw new Error('the connectors suite does not drive browser flows')
  }

  cancel(_id: string): void {
    throw new Error('the connectors suite does not drive browser flows')
  }

  async ensureFresh(id: string): Promise<void> {
    this.ensured.push(id)
    await sdk.flowControl.ensureFreshImpl()
  }
}


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
  '    howTo: Create an internal integration.',
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

const ATLAS_YML = [
  'id: atlas',
  'name: Atlassian',
  'description: Jira and Confluence.',
  'presetId: atlas',
  'workspaceDirName: atlassian',
  'auth:',
  '  - mode: token',
  '    credentialRefs:',
  '      - ATLASSIAN_USERNAME',
  '      - ATLASSIAN_TOKEN',
  'servers:',
  '  - serverName: atlas',
  '    transport: stdio',
  '    command: node',
  '    args: [fixture]',
  '    env:',
  '      ATL_API_BASE_URL: { $override: url }',
  '      ATL_USERNAME: { $cred: ATLASSIAN_USERNAME }',
  '      ATL_TOKEN: { $cred: ATLASSIAN_TOKEN }',
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
  '    setupGuide:',
  '      - Create an OAuth client in Google Cloud.',
  '    reauthHint: Personal accounts re-authenticate every 7 days.',
  'servers:',
  '  - serverName: google-gmail',
  '    transport: streamable-http',
  '    url: https://gmailmcp.googleapis.com/mcp/v1',
  '',
].join('\n')

const DUO_YML = [
  'id: duo',
  'name: Duo',
  'description: Two mounted servers.',
  'presetId: duo',
  'workspaceDirName: duo',
  'auth:',
  '  - mode: token',
  '    credentialRefs:',
  '      - DUO_TOKEN',
  'servers:',
  // duo-a: a bare stdio server (no args, no env) that still carries cwd and a timeout.
  '  - serverName: duo-a',
  '    transport: stdio',
  '    command: node',
  '    cwd: /tmp',
  '    toolCallTimeoutMs: 1200',
  // duo-b: an http server with a literal header, a credential header, and a timeout.
  '  - serverName: duo-b',
  '    transport: streamable-http',
  '    url: http://127.0.0.1:8080/mcp',
  '    toolCallTimeoutMs: 300',
  '    headers:',
  '      X-Static: literal',
  '      X-Api-Key: { $cred: DUO_TOKEN }',
  '',
].join('\n')

const M365_YML = [
  'id: m365',
  'name: Microsoft 365',
  'description: Outlook, OneDrive, and Teams.',
  'presetId: m365',
  'workspaceDirName: m365',
  'auth:',
  '  - mode: device',
  '    howTo: Sign in with your work account.',
  '    loginTool: login',
  '    verifyTool: verify-login',
  'servers:',
  '  - serverName: m365',
  '    transport: stdio',
  '    command: npx',
  "    args: [-y, '@softeria/ms-365-mcp-server']",
  '',
].join('\n')

const MISLABELED_YML = [
  'id: mislabeled',
  'name: Mislabeled',
  'description: A slot the token method does not declare.',
  'presetId: mislabeled',
  'workspaceDirName: mislabeled',
  'auth:',
  '  - mode: token',
  '    credentialRefs:',
  '      - MIS_TOKEN',
  'servers:',
  '  - serverName: mislabeled',
  '    transport: stdio',
  '    command: node',
  '    args: [fixture]',
  '    env:',
  '      OTHER_KEY: { $cred: OTHER_MISSING }',
  '',
].join('\n')

const CATALOG = [
  ['atlas.yml', ATLAS_YML],
  ['duo.yml', DUO_YML],
  ['google.yml', GOOGLE_YML],
  ['m365.yml', M365_YML],
  ['mislabeled.yml', MISLABELED_YML],
  ['notion.yml', NOTION_YML],
] as const

const cleanups: Array<() => Promise<void>> = []
const fibers: Array<{ dispose: () => Promise<void> }> = []

beforeEach(() => {
  // Tests override the connect behavior to gate or fail attempts; every test
  // starts from a clean, immediately-succeeding connect.
  sdk.control.connectImpl = async () => {}
  sdk.flowControl.ensureFreshImpl = async () => {}
})

afterEach(async () => {
  while (fibers.length > 0) await fibers.pop()!.dispose()
  while (cleanups.length > 0) await cleanups.pop()!()
  vi.unstubAllEnvs()
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-connectors-${prefix}-`))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

type FileList = ReadonlyArray<readonly [string, string]>

async function writeCatalog(dir: string, files: FileList = CATALOG): Promise<void> {
  for (const [name, text] of files) await writeFile(join(dir, name), text)
}

// Keeps the plugin fiber's thenable identity (ctx.plugin returns a
// PromiseLike wrapper, not a bare Fiber) so callers can await the boot.
function track<T extends { dispose: () => Promise<void> }>(fiber: T): T {
  fibers.push(fiber)
  return fiber
}

interface BootOptions {
  catalogFiles?: FileList
  userDirFiles?: FileList
  withCredentials?: boolean
  withTokens?: boolean
  withPresets?: boolean
  withOAuthFlow?: boolean
}

async function boot(options: BootOptions = {}): Promise<{ ctx: Context; root: string }> {
  const root = await tempDir('root')
  const catalogDir = join(root, 'catalog')
  const userDir = join(root, 'user')
  const mcpDir = join(root, '.mcp')
  await mkdir(catalogDir, { recursive: true })
  await writeCatalog(catalogDir, options.catalogFiles ?? CATALOG)
  if (options.userDirFiles !== undefined) {
    await mkdir(userDir, { recursive: true, mode: 0o700 })
    for (const [name, text] of options.userDirFiles) await writeFile(join(userDir, name), text, { mode: 0o600 })
  }

  const ctx = new Context()
  await track(ctx.plugin(Loader))
  ctx.loader.builtins.include = Include
  await track(ctx.plugin(SystemPrompt))
  await track(ctx.plugin(ToolRuntime))
  await track(ctx.plugin(McpRegistry))
  await track(ctx.plugin(McpManager, { mcpDir }))
  if (options.withCredentials ?? true) {
    await track(ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false }))
  }
  if (options.withTokens ?? true) {
    await track(ctx.plugin(OAuthTokenStore, { path: join(root, 'tokens.json'), watch: false }))
  }
  if (options.withOAuthFlow) {
    new FakeOAuthFlow(ctx)
  }
  if (options.withPresets ?? true) {
    const systemPresets = join(root, 'presets')
    await mkdir(join(systemPresets, 'custom'), { recursive: true })
    await writeFile(join(systemPresets, 'custom', 'agent.cordis.yml'), '- id: stub\n  name: test:stub-preset\n')
    const home = await tempDir('home')
    vi.stubEnv('DSH_HOME', home)
    await track(ctx.plugin(AgentPresets, {
      default: 'custom',
      roots: [{ path: systemPresets, trust: 'system' }],
      includeUserRoot: true,
    }))
  }
  await track(ctx.plugin(Connectors, { catalogDir, userDir }))
  return { ctx, root }
}

async function poll(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
}

async function stateOf(ctx: Context, id: string): Promise<string> {
  return (await ctx.connectors.get(id))?.state ?? 'missing'
}

describe('catalog and list', () => {
  it('lists every catalog connector, sorted and secret-free', async () => {
    const { ctx } = await boot()
    const views = await ctx.connectors.list()
    expect(views.map(view => view.id)).toEqual(['atlas', 'duo', 'google', 'm365', 'mislabeled', 'notion'])
    for (const view of views) {
      expect(view.state).toBe('unconfigured')
      expect(view.custom).toBe(false)
      expect(view.servers.every(server => !server.mounted && server.status === undefined)).toBe(true)
    }
    const wire = JSON.stringify(views)
    expect(wire).not.toContain('fixture')
    expect(wire).not.toContain('npx')
    expect(wire).not.toContain('gmailmcp.googleapis.com')
    const notion = views.find(view => view.id === 'notion')
    expect(notion?.auth).toEqual([
      {
        mode: 'token', configured: false, howTo: 'Create an internal integration.',
        credentialRefs: ['NOTION_API_TOKEN'],
      },
    ])
    expect(notion?.suggestions).toEqual(['Summarize my workspace'])
    const google = views.find(view => view.id === 'google')
    expect(google?.auth).toEqual([
      {
        mode: 'oauth',
        configured: false,
        setupGuide: ['Create an OAuth client in Google Cloud.'],
        reauthHint: 'Personal accounts re-authenticate every 7 days.',
      },
    ])
    expect(google?.products).toEqual(['gmail', 'drive'])
  })

  it('boots loud on a malformed catalog manifest', async () => {
    const root = await tempDir('bad-catalog')
    await mkdir(join(root, 'catalog'), { recursive: true })
    await writeFile(join(root, 'catalog', 'bad.yml'), 'id: Bad Id\nname: X\ndescription: X\npresetId: x\nworkspaceDirName: x\nservers: []\nauth: []\n')
    const ctx = new Context()
    const fiber = ctx.plugin(McpRegistry)
    fibers.push(fiber)
    await fiber
    const managerFiber = ctx.plugin(McpManager, { mcpDir: join(root, '.mcp') })
    fibers.push(managerFiber)
    await managerFiber
    const connectorsFiber = ctx.plugin(Connectors, { catalogDir: join(root, 'catalog'), userDir: join(root, 'user') })
    await expect(connectorsFiber).rejects.toThrow(/invalid manifest/)
  })

  it('rejects an override document with an unknown field at boot', async () => {
    await expect(boot({
      userDirFiles: [['atlas.json', JSON.stringify({ url: 'https://x.atlassian.net', bogus: true })]],
    })).rejects.toThrow(/unknown field "bogus"/)
  })

  it('loads a persisted override document into the snapshot at boot', async () => {
    const { ctx } = await boot({
      userDirFiles: [['atlas.json', JSON.stringify({ url: 'https://x.atlassian.net' })]],
    })
    // The override alone does not configure a token method.
    expect(await stateOf(ctx, 'atlas')).toBe('unconfigured')
    // With the token stored, the boot-loaded override resolves the slot and
    // the auto-connect succeeds.
    await ctx.connectors.configure('atlas', { credentials: { ATLASSIAN_USERNAME: 'me', ATLASSIAN_TOKEN: 'tok' } })
    await poll(() => ctx.tools.get('mcp__atlas__remote') !== undefined, 'atlas tool')
    expect(await stateOf(ctx, 'atlas')).toBe('connected')
  })
})

describe('token flow', () => {
  it('refuses to connect before the credential is stored', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.connect('notion', 'token')).rejects.toThrow(ConnectorCredentialMissingError)
    await expect(ctx.connectors.connect('notion', 'token')).rejects.toThrow(/NOTION_API_TOKEN/)
  })

  it('configures, auto-connects, and disconnects', async () => {
    const { ctx, root } = await boot()
    const events: Array<[string, string]> = []
    ctx.on('connector/state', (id, state) => {
      events.push([id, state])
    })

    await ctx.connectors.configure('notion', { token: 'sekret' })
    await poll(() => ctx.tools.get('mcp__notion__remote') !== undefined, 'notion tool')
    expect(await stateOf(ctx, 'notion')).toBe('connected')
    expect(events).toEqual([['notion', 'connected']])

    // The persisted server document keeps the credential reference;
    // mcp-client resolves it at connect time from the credentials store.
    const serverDoc = await readFile(join(root, '.mcp', 'notion.cordis.yml'), 'utf8')
    expect(serverDoc).toContain('$cred: NOTION_API_TOKEN')
    expect(serverDoc).not.toContain('sekret')
    const credDoc = await readFile(join(root, '.credentials.yaml'), 'utf8')
    expect(credDoc).toContain('NOTION_API_TOKEN')

    // Re-configuring to the same state emits no second event.
    await ctx.connectors.configure('notion', { token: 'sekret' })
    expect(events).toEqual([['notion', 'connected']])

    await ctx.connectors.disconnect('notion')
    expect(ctx.tools.get('mcp__notion__remote')).toBeUndefined()
    expect(await stateOf(ctx, 'notion')).toBe('unconfigured')
    expect(events).toEqual([['notion', 'connected'], ['notion', 'unconfigured']])
    expect(await readFile(join(root, '.credentials.yaml'), 'utf8')).not.toContain('NOTION_API_TOKEN')
    await expect(readFile(join(root, '.mcp', 'notion.cordis.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('refuses a configure with an unknown credential reference', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.configure('notion', { credentials: { WRONG_REF: 'x' } })).rejects.toThrow(/not a credential reference/)
  })

  it('refuses a clientSecret on a connector without byoApp OAuth', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.configure('notion', { clientSecret: 'x' })).rejects.toThrow(/no bring-your-own-app OAuth/)
  })

  it('resolves a multi-reference token plus an override field', async () => {
    const { ctx, root } = await boot()
    // No stored credentials yet: the connect pre-check fails on the first
    // declared reference.
    await expect(ctx.connectors.connect('atlas', 'token')).rejects.toThrow(ConnectorCredentialMissingError)
    await expect(ctx.connectors.connect('atlas', 'token')).rejects.toThrow(/ATLASSIAN_USERNAME/)

    await ctx.connectors.configure('atlas', { credentials: { ATLASSIAN_USERNAME: 'me' } })
    expect(await stateOf(ctx, 'atlas')).toBe('unconfigured')

    // The second reference is still missing.
    await expect(ctx.connectors.connect('atlas', 'token')).rejects.toThrow(ConnectorCredentialMissingError)

    // Both references stored but the override unset: the mount preparation
    // fails for the missing override.
    await ctx.connectors.configure('atlas', { credentials: { ATLASSIAN_TOKEN: 'tok' } })
    await expect(ctx.connectors.connect('atlas', 'token')).rejects.toThrow(ConnectorOverrideMissingError)

    // The url no longer blocks the pre-check; an explicit connect mounts.
    await ctx.connectors.configure('atlas', { url: 'https://x.atlassian.net' })
    await ctx.connectors.connect('atlas', 'token')
    await poll(() => ctx.tools.get('mcp__atlas__remote') !== undefined, 'atlas tool')
    expect(await stateOf(ctx, 'atlas')).toBe('connected')

    // The document resolves the override to its literal and keeps the
    // credential references for mcp-client, never the stored values.
    const [entry] = parse(await readFile(join(root, '.mcp', 'atlas.cordis.yml'), 'utf8')) as Array<{ config: { env: Record<string, unknown> } }>
    if (entry === undefined) throw new Error('the atlas server document is empty')
    expect(entry.config.env).toEqual({
      ATL_API_BASE_URL: 'https://x.atlassian.net',
      ATL_USERNAME: { $cred: 'ATLASSIAN_USERNAME' },
      ATL_TOKEN: { $cred: 'ATLASSIAN_TOKEN' },
    })

    const overrideDoc = JSON.parse(await readFile(join(root, 'user', 'atlas.json'), 'utf8')) as Record<string, unknown>
    expect(overrideDoc).toEqual({ url: 'https://x.atlassian.net' })

    await ctx.connectors.disconnect('atlas')
    expect(await stateOf(ctx, 'atlas')).toBe('unconfigured')
    await expect(readFile(join(root, 'user', 'atlas.json'), 'utf8')).rejects.toThrow(/ENOENT/)
  })
})

describe('oauth and device modes', () => {
  it('refuses oauth and device flows that have no engine in this deployment', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.connect('google', 'oauth')).rejects.toThrow(ConnectorAuthUnavailableError)
    await expect(ctx.connectors.connect('m365', 'device')).rejects.toThrow(ConnectorAuthUnavailableError)
    await expect(ctx.connectors.connect('notion', 'oauth')).rejects.toThrow(/supports no oauth auth/)
  })

  it('refuses an oauth connect that has no stored bundle yet', async () => {
    const { ctx } = await boot({ withOAuthFlow: true })
    await expect(ctx.connectors.connect('google', 'oauth')).rejects.toThrow(ConnectorAuthPendingError)
  })

  it('mounts an oauth connector through its stored bundle, keeping it fresh', async () => {
    const { ctx } = await boot({ withOAuthFlow: true })
    const now = Date.now()
    await ctx.oauthTokens.put('google', {
      accessToken: 'at',
      expiresAt: now + 3_600_000,
      tokenEndpoint: 'https://example.com/token',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.connectors.connect('google', 'oauth')
    const flow = ctx.oauthFlow as FakeOAuthFlow
    expect(flow.ensured).toContain('google')
    await poll(async () => (await stateOf(ctx, 'google')) === 'connected', 'google connected')
  })

  it('fails the oauth connect when the refresh refuses', async () => {
    const { ctx } = await boot({ withOAuthFlow: true })
    const now = Date.now()
    await ctx.oauthTokens.put('google', {
      accessToken: 'at',
      expiresAt: now + 3_600_000,
      tokenEndpoint: 'https://example.com/token',
      createdAt: now,
      updatedAt: now,
    })
    sdk.flowControl.ensureFreshImpl = async () => { throw new Error('refresh refused') }
    await expect(ctx.connectors.connect('google', 'oauth')).rejects.toThrow('refresh refused')
    expect(await stateOf(ctx, 'google')).toBe('needs-auth')
  })

  it('records a flow failure as the connector error state and republishes a repeat failure', async () => {
    const { ctx } = await boot()
    const events: string[] = []
    ctx.on('connector/state', (_id, state) => { events.push(state) })
    await ctx.connectors.recordFlowFailure('google', 'the sign-in was canceled')
    expect(await stateOf(ctx, 'google')).toBe('error')
    expect((await ctx.connectors.get('google'))?.lastError).toBe('the sign-in was canceled')
    await ctx.connectors.recordFlowFailure('google', 'the callback state did not match the flow')
    expect((await ctx.connectors.get('google'))?.lastError).toBe('the callback state did not match the flow')
    expect(events).toEqual(['error', 'error'])
    expect(ctx.connectors.overrideClientId('google')).toBeUndefined()
    await ctx.connectors.configure('google', { clientId: 'abc.apps.googleusercontent.com' })
    expect(ctx.connectors.overrideClientId('google')).toBe('abc.apps.googleusercontent.com')
    // configure does not mount an oauth connector, so the recorded failure
    // persists through it and clears with the next settled operation.
    expect(await stateOf(ctx, 'google')).toBe('error')
    await ctx.connectors.disconnect('google')
    expect((await ctx.connectors.get('google'))?.lastError).toBeUndefined()
    expect(await stateOf(ctx, 'google')).toBe('unconfigured')
  })

  it('tracks byoApp configuration: the client id is the requirement, the secret optional', async () => {
    const { ctx, root } = await boot()
    await ctx.connectors.configure('google', { clientId: 'abc.apps.googleusercontent.com' })
    expect(await stateOf(ctx, 'google')).toBe('needs-auth')

    await ctx.connectors.configure('google', { clientSecret: 'shh' })
    expect(await stateOf(ctx, 'google')).toBe('needs-auth')
    const overrideDoc = JSON.parse(await readFile(join(root, 'user', 'google.json'), 'utf8')) as Record<string, unknown>
    expect(overrideDoc).toEqual({ clientId: 'abc.apps.googleusercontent.com' })
    const credDoc = await readFile(join(root, '.credentials.yaml'), 'utf8')
    expect(credDoc).toContain(clientSecretRef('google'))

    await ctx.connectors.disconnect('google')
    expect(await stateOf(ctx, 'google')).toBe('unconfigured')
    expect(await readFile(join(root, '.credentials.yaml'), 'utf8')).not.toContain(clientSecretRef('google'))
  })

  it('counts a stored token bundle as configured', async () => {
    const { ctx } = await boot()
    const now = Date.now()
    await ctx.oauthTokens.put('google', {
      accessToken: 'at',
      expiresAt: now + 3_600_000,
      tokenEndpoint: 'https://example.com/token',
      createdAt: now,
      updatedAt: now,
    })
    expect(await stateOf(ctx, 'google')).toBe('needs-auth')
    await ctx.connectors.disconnect('google')
    expect(ctx.oauthTokens.get('google')).toBeUndefined()
  })
})

describe('derived states', () => {
  it('reports connecting while the initial connect is gated', async () => {
    const { ctx } = await boot()
    let release!: () => void
    sdk.control.connectImpl = () => new Promise<void>((resolveWait) => {
      release = resolveWait
    })
    // The fiber await would hang on the gated attempt, so the test drives the
    // gate through the pollers instead.
    const fiber = ctx.plugin(McpClient, {
      serverName: 'atlas',
      transport: 'stdio',
      command: 'node',
      args: ['fixture'],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
    fibers.push(fiber)
    await poll(() => typeof release === 'function', 'gated initial connect')
    await poll(async () => (await stateOf(ctx, 'atlas')) === 'connecting', 'connecting state')
    release()
    await fiber
    await poll(async () => (await stateOf(ctx, 'atlas')) === 'connected', 'connected state')
  })

  it('reports reconnecting after a failure and down after the budget exhausts', async () => {
    const { ctx } = await boot()
    let attempt = 0
    sdk.control.connectImpl = async () => {
      attempt += 1
      throw new Error('no provider for you')
    }
    const fiber = ctx.plugin(McpClient, {
      serverName: 'm365',
      transport: 'stdio',
      command: 'node',
      args: ['fixture'],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
      reconnect: { maxAttempts: 3, initialDelayMs: 25 },
    })
    fibers.push(fiber)
    await fiber
    await poll(async () => (await stateOf(ctx, 'm365')) === 'reconnecting', 'reconnecting state')
    await poll(async () => (await stateOf(ctx, 'm365')) === 'down', 'down state')
    expect(attempt).toBeGreaterThanOrEqual(3)
  })

  it('reports authorizing while a flow is in flight', async () => {
    const { ctx } = await boot()
    ctx.connectors.setAuthorizing('notion', true)
    expect(await stateOf(ctx, 'notion')).toBe('authorizing')
    ctx.connectors.setAuthorizing('notion', false)
    expect(await stateOf(ctx, 'notion')).toBe('unconfigured')
  })

  it('reports error with the last failure when a name is already taken', async () => {
    const { ctx } = await boot()
    // Occupy the name with a profile-declared-style direct mount.
    let release!: () => void
    sdk.control.connectImpl = () => new Promise<void>((resolveWait) => {
      release = resolveWait
    })
    const fiber = ctx.plugin(McpClient, {
      serverName: 'notion',
      transport: 'stdio',
      command: 'node',
      args: ['fixture'],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
    fibers.push(fiber)
    await poll(() => typeof release === 'function', 'gated initial connect')
    release()
    await fiber
    await poll(async () => (await stateOf(ctx, 'notion')) === 'connected', 'notion connected')

    await ctx.connectors.configure('notion', { token: 'sekret' })
    const view = await ctx.connectors.get('notion')
    expect(view?.state).toBe('error')
    expect(view?.lastError).toContain('already taken')
  })
})

describe('custom connectors', () => {
  it('adds a no-auth custom connector and mounts it at once', async () => {
    const { ctx } = await boot()
    const home = process.env.DSH_HOME
    const id = await ctx.connectors.addCustom({
      name: 'My Local API',
      transport: 'streamable-http',
      url: 'http://127.0.0.1:9999/mcp',
    })
    expect(id).toBe('custom-my-local-api')
    await poll(() => ctx.tools.get('mcp__custom-my-local-api__remote') !== undefined, 'custom tool')
    const view = await ctx.connectors.get(id)
    expect(view?.state).toBe('connected')
    expect(view?.custom).toBe(true)
    expect(await stat(join(home!, '.agent-presets', id, 'agent.cordis.yml'))).toBeDefined()

    // Duplicate id refuses.
    await expect(ctx.connectors.addCustom({ name: 'My Local API', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' }))
      .rejects.toThrow(ConnectorExistsError)

    await ctx.connectors.removeCustom(id)
    expect(ctx.tools.get('mcp__custom-my-local-api__remote')).toBeUndefined()
    expect(await ctx.connectors.get(id)).toBeUndefined()
    await expect(stat(join(home!, '.agent-presets', id))).rejects.toThrow(/ENOENT/)
  })

  it('adds a token-auth custom connector from an explicit id', async () => {
    const { ctx } = await boot()
    const id = await ctx.connectors.addCustom({
      name: 'Authed CLI',
      id: 'authed',
      transport: 'stdio',
      command: 'node',
      args: ['fixture'],
      tokenVar: 'API_TOKEN',
    })
    expect(id).toBe('custom-authed')
    const manifest = ctx.connectors.manifest(id)
    const stdio = manifest?.servers[0]
    if (stdio === undefined || stdio.transport !== 'stdio') throw new Error('expected a stdio custom server')
    expect(stdio.env?.API_TOKEN).toEqual({ $cred: 'DSH_CONNECTOR_AUTHED_TOKEN' })

    await expect(ctx.connectors.connect(id, 'token')).rejects.toThrow(ConnectorCredentialMissingError)
    await ctx.connectors.configure(id, { token: 't' })
    await poll(() => ctx.tools.get(`mcp__${id}__remote`) !== undefined, 'custom-authed tool')
    expect(await stateOf(ctx, id)).toBe('connected')
  })

  it('removing a custom whose preset was hand-deleted still succeeds', async () => {
    const { ctx } = await boot()
    const home = process.env.DSH_HOME
    const id = await ctx.connectors.addCustom({ name: 'Orphan', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' })
    await rm(join(home!, '.agent-presets', id), { recursive: true, force: true })
    await expect(ctx.connectors.removeCustom(id)).resolves.toBeUndefined()
    expect(await ctx.connectors.get(id)).toBeUndefined()
  })

  it('refuses to remove a shipped connector or a missing one', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.removeCustom('notion')).rejects.toThrow(ConnectorNotCustomError)
    await expect(ctx.connectors.removeCustom('custom-missing')).rejects.toThrow(ConnectorNotFoundError)
  })

  it('validates the custom spec at the boundary', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.addCustom({ name: 'X', transport: 'stdio' })).rejects.toThrow(/needs a command/)
    await expect(ctx.connectors.addCustom({ name: 'X', transport: 'streamable-http' })).rejects.toThrow(/needs a url/)
    await expect(ctx.connectors.addCustom({ name: 'X', transport: 'stdio', command: 'node', headers: { A: 'b' } }))
      .rejects.toThrow(/headers belong to a streamable-http/)
    await expect(ctx.connectors.addCustom({ name: 'X', transport: 'streamable-http', url: 'http://x/mcp', env: { A: 'b' } }))
      .rejects.toThrow(/env vars belong to a stdio/)
    await expect(ctx.connectors.addCustom({ name: 'X', transport: 'stdio', command: 'node', tokenVar: 'H', tokenVarIsHeader: true }))
      .rejects.toThrow(/header token var needs a streamable-http/)
    await expect(ctx.connectors.addCustom({ name: '!!!', transport: 'streamable-http', url: 'http://x/mcp' }))
      .rejects.toThrow(/does not yield a valid connector id/)
  })

  it('persists a bare stdio custom without args or env', async () => {
    const { ctx } = await boot()
    const id = await ctx.connectors.addCustom({ name: 'Bare', id: 'bare', transport: 'stdio', command: 'node' })
    const stdio = ctx.connectors.manifest(id)?.servers[0]
    if (stdio === undefined || stdio.transport !== 'stdio') throw new Error('expected a stdio custom server')
    expect(stdio.args).toEqual([])
    expect(stdio.env).toBeUndefined()
    await poll(() => ctx.tools.get(`mcp__${id}__remote`) !== undefined, 'bare custom tool')
    expect(await stateOf(ctx, id)).toBe('connected')
  })

  it('auths a streamable-http custom through a token header', async () => {
    const { ctx } = await boot()
    const id = await ctx.connectors.addCustom({
      name: 'Hdr',
      id: 'hdr',
      transport: 'streamable-http',
      url: 'http://127.0.0.1:4000/mcp',
      headers: { 'X-Static': 'one' },
      tokenVar: 'Authorization',
      tokenVarIsHeader: true,
    })
    const http = ctx.connectors.manifest(id)?.servers[0]
    if (http === undefined || http.transport !== 'streamable-http') throw new Error('expected an http custom server')
    expect(http.headers).toEqual({ 'X-Static': 'one', Authorization: { $cred: 'DSH_CONNECTOR_HDR_TOKEN' } })

    await ctx.connectors.configure(id, { token: 't' })
    await poll(() => ctx.tools.get(`mcp__${id}__remote`) !== undefined, 'hdr custom tool')
    expect(await stateOf(ctx, id)).toBe('connected')
  })

  it('removes a custom when the preset and credentials seams are absent', async () => {
    const custom = JSON.stringify({
      id: 'custom-local',
      name: 'Local',
      description: 'A local server.',
      presetId: 'custom-local',
      workspaceDirName: 'local',
      servers: [{ serverName: 'custom-local', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' }],
      auth: [],
    })
    const { ctx } = await boot({
      userDirFiles: [['custom-local.json', custom]],
      withCredentials: false,
      withTokens: false,
      withPresets: false,
    })
    await expect(ctx.connectors.removeCustom('custom-local')).resolves.toBeUndefined()
    expect(await ctx.connectors.get('custom-local')).toBeUndefined()
  })

  it('unsets the stored credential when removing a token-auth custom', async () => {
    const { ctx, root } = await boot()
    const id = await ctx.connectors.addCustom({ name: 'Authed CLI', id: 'authed', transport: 'stdio', command: 'node', tokenVar: 'API_TOKEN' })
    await ctx.connectors.configure(id, { token: 't' })
    expect(await readFile(join(root, '.credentials.yaml'), 'utf8')).toContain('DSH_CONNECTOR_AUTHED_TOKEN')
    await ctx.connectors.removeCustom(id)
    expect(await ctx.connectors.get(id)).toBeUndefined()
    expect(ctx.tools.get(`mcp__${id}__remote`)).toBeUndefined()
    expect(await readFile(join(root, '.credentials.yaml'), 'utf8')).not.toContain('DSH_CONNECTOR_AUTHED_TOKEN')
  })

  it('rethrows a preset removal failure that is not a hand deletion', async () => {
    if (process.platform === 'win32') return
    const { ctx } = await boot()
    const home = process.env.DSH_HOME
    const id = await ctx.connectors.addCustom({ name: 'Locked', transport: 'streamable-http', url: 'http://127.0.0.1:6000/mcp' })
    await chmod(join(home!, '.agent-presets'), 0o500)
    try {
      await expect(ctx.connectors.removeCustom(id)).rejects.toThrow(/EACCES|EPERM/)
      // The removal failed before its manifest step: the connector is intact.
      expect(await ctx.connectors.get(id)).toBeDefined()
    } finally {
      await chmod(join(home!, '.agent-presets'), 0o700)
    }
    await expect(ctx.connectors.removeCustom(id)).resolves.toBeUndefined()
    expect(await ctx.connectors.get(id)).toBeUndefined()
  })

  it('removes the preset copy when the custom manifest write fails', async () => {
    const root = await tempDir('rollback')
    const catalogDir = join(root, 'catalog')
    await mkdir(catalogDir, { recursive: true })
    const userDir = join(root, 'user')
    await mkdir(userDir, { recursive: true, mode: 0o700 })
    const systemPresets = join(root, 'presets')
    await mkdir(join(systemPresets, 'custom'), { recursive: true })
    await writeFile(join(systemPresets, 'custom', 'agent.cordis.yml'), '- id: stub\n  name: test:stub-preset\n')
    const home = await tempDir('home')
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    await track(ctx.plugin(Loader))
    ctx.loader.builtins.include = Include
    await track(ctx.plugin(SystemPrompt))
    await track(ctx.plugin(ToolRuntime))
    await track(ctx.plugin(McpRegistry))
    await track(ctx.plugin(McpManager, { mcpDir: join(root, '.mcp') }))
    await track(ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false }))
    await track(ctx.plugin(OAuthTokenStore, { path: join(root, 'tokens.json'), watch: false }))
    await track(ctx.plugin(AgentPresets, {
      default: 'custom',
      roots: [{ path: systemPresets, trust: 'system' }],
      includeUserRoot: true,
    }))
    await track(ctx.plugin(Connectors, { catalogDir, userDir }))
    // Replace the user directory with a regular file: every manifest write fails.
    await rm(userDir, { recursive: true })
    await writeFile(userDir, 'block')
    await expect(ctx.connectors.addCustom({ name: 'X', id: 'x', transport: 'streamable-http', url: 'http://127.0.0.1/mcp' }))
      .rejects.toThrow()
    // The rollback removed the preset copy and left no connector behind.
    await expect(stat(join(home, '.agent-presets', 'custom-x'))).rejects.toThrow(/ENOENT/)
    expect(await ctx.connectors.get('custom-x')).toBeUndefined()
  })

  it('records the failure when a no-auth custom mount is refused', async () => {
    const { ctx } = await boot()
    // Occupy the custom's server name with a direct (profile-style) mount.
    const fiber = ctx.plugin(McpClient, {
      serverName: 'custom-dead',
      transport: 'stdio',
      command: 'node',
      args: ['fixture'],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
    track(fiber)
    await fiber
    const id = await ctx.connectors.addCustom({ name: 'Dead', id: 'dead', transport: 'streamable-http', url: 'http://127.0.0.1:5000/mcp' })
    expect(id).toBe('custom-dead')
    const view = await ctx.connectors.get(id)
    expect(view?.state).toBe('error')
    expect(view?.lastError).toContain('already taken')
  })
})

describe('override document validation', () => {
  it('rejects an override document that is not an object at boot', async () => {
    await expect(boot({ userDirFiles: [['notion.json', '[1, 2]']] })).rejects.toThrow(/must be a JSON object/)
  })

  it('rejects an invalid-JSON override document at boot', async () => {
    await expect(boot({ userDirFiles: [['notion.json', '{oops']] })).rejects.toThrow(/not valid JSON/)
  })

  it('rejects an override field of the wrong type at boot', async () => {
    await expect(boot({ userDirFiles: [['atlas.json', JSON.stringify({ url: 42 })]] })).rejects.toThrow(/override field "url" of "atlas" must be a string/)
    await expect(boot({ userDirFiles: [['atlas.json', JSON.stringify({ orgMode: 'yes' })]] })).rejects.toThrow(/override field "orgMode" of "atlas" must be a boolean/)
  })

  it('rejects a products override that is not a string array at boot', async () => {
    await expect(boot({ userDirFiles: [['google.json', JSON.stringify({ products: 'gmail' })]] })).rejects.toThrow(/must be an array of strings/)
    await expect(boot({ userDirFiles: [['google.json', JSON.stringify({ products: ['gmail', 42] })]] })).rejects.toThrow(/must be an array of strings/)
  })

  it('loads a full override document at boot', async () => {
    const { ctx } = await boot({
      userDirFiles: [['google.json', JSON.stringify({ clientId: 'app.example', products: ['gmail'], orgMode: true, readOnly: false })]],
    })
    expect(await stateOf(ctx, 'google')).toBe('unconfigured')
  })
})

describe('configure fields', () => {
  it('refuses a token configure on a connector without a token method', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.configure('google', { token: 'x' })).rejects.toThrow(/supports no token auth/)
  })

  it('stores products, orgMode, and readOnly override fields', async () => {
    const { ctx, root } = await boot()
    await ctx.connectors.configure('google', { products: ['gmail'], orgMode: true, readOnly: false })
    const doc = JSON.parse(await readFile(join(root, 'user', 'google.json'), 'utf8')) as Record<string, unknown>
    expect(doc).toEqual({ products: ['gmail'], orgMode: true, readOnly: false })
    // Override fields alone do not configure a token method.
    expect(await stateOf(ctx, 'google')).toBe('unconfigured')
  })
})

describe('connect and disconnect edges', () => {
  it('connects an already-mounted connector without a second transition', async () => {
    const { ctx } = await boot()
    const events: Array<[string, string]> = []
    ctx.on('connector/state', (id, state) => {
      events.push([id, state])
    })
    await ctx.connectors.configure('notion', { token: 'sekret' })
    await poll(() => ctx.tools.get('mcp__notion__remote') !== undefined, 'notion tool')
    await expect(ctx.connectors.connect('notion', 'token')).resolves.toBeUndefined()
    expect(await stateOf(ctx, 'notion')).toBe('connected')
    expect(events).toEqual([['notion', 'connected']])
  })

  it('disconnects cleanly when the credentials and token seams are absent', async () => {
    const { ctx } = await boot({ withCredentials: false, withTokens: false })
    await expect(ctx.connectors.disconnect('notion')).resolves.toBeUndefined()
    expect(await stateOf(ctx, 'notion')).toBe('unconfigured')
  })

  it('reports the credential missing when the credentials seam itself is absent', async () => {
    const { ctx } = await boot({ withCredentials: false, withTokens: false })
    await expect(ctx.connectors.connect('notion', 'token')).rejects.toThrow(ConnectorCredentialMissingError)
  })

  it('refuses an operation on an unknown connector', async () => {
    const { ctx } = await boot()
    await expect(ctx.connectors.connect('nope', 'token')).rejects.toThrow(ConnectorNotFoundError)
    await expect(ctx.connectors.disconnect('nope')).rejects.toThrow(ConnectorNotFoundError)
  })
})

describe('multi-server mount', () => {
  it('mounts every declared server with the resolved slots', async () => {
    const { ctx, root } = await boot()
    await ctx.connectors.configure('duo', { token: 'duo-secret' })
    await poll(() => ctx.tools.get('mcp__duo-a__remote') !== undefined, 'duo-a tool')
    await poll(() => ctx.tools.get('mcp__duo-b__remote') !== undefined, 'duo-b tool')
    expect(await stateOf(ctx, 'duo')).toBe('connected')
    const docA = await readFile(join(root, '.mcp', 'duo-a.cordis.yml'), 'utf8')
    expect(docA).toContain('cwd')
    const docB = await readFile(join(root, '.mcp', 'duo-b.cordis.yml'), 'utf8')
    expect(docB).toContain('literal')
    expect(docB).toContain('$cred: DUO_TOKEN')
    expect(docB).not.toContain('duo-secret')
  })

  it('unmounts the servers it added when a later mount is refused', async () => {
    const { ctx } = await boot()
    // Occupy duo-b with a direct (profile-style) mount.
    const fiber = ctx.plugin(McpClient, {
      serverName: 'duo-b',
      transport: 'streamable-http',
      url: 'http://127.0.0.1:9000/mcp',
      headers: {},
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
    track(fiber)
    await fiber
    await ctx.connectors.configure('duo', { token: 't' })
    const view = await ctx.connectors.get('duo')
    expect(view?.state).toBe('error')
    expect(view?.lastError).toContain('already taken')
    // The first server's mount was rolled back with it.
    expect(ctx.tools.get('mcp__duo-a__remote')).toBeUndefined()
  })
})

describe('boot configuration edges', () => {
  it('defaults the user directory to the harness home and tolerates a missing catalog directory', async () => {
    const home = await tempDir('home')
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    await track(ctx.plugin(McpRegistry))
    await track(ctx.plugin(McpManager, { mcpDir: join(home, '.mcp') }))
    await track(ctx.plugin(Connectors))
    expect((await ctx.connectors.list()).length).toBe(0)

    const root = await tempDir('no-catalog')
    const ctx2 = new Context()
    await track(ctx2.plugin(McpRegistry))
    await track(ctx2.plugin(McpManager, { mcpDir: join(root, '.mcp') }))
    await track(ctx2.plugin(Connectors, { catalogDir: join(root, 'missing'), userDir: join(root, 'user') }))
    expect((await ctx2.connectors.list()).length).toBe(0)
  })

  it('boots loud when the catalog path is not a directory', async () => {
    const root = await tempDir('catalog-file')
    const catalog = join(root, 'catalog')
    await writeFile(catalog, 'not a dir')
    const ctx = new Context()
    await track(ctx.plugin(McpRegistry))
    await track(ctx.plugin(McpManager, { mcpDir: join(root, '.mcp') }))
    const fiber = ctx.plugin(Connectors, { catalogDir: catalog, userDir: join(root, 'user') })
    track(fiber)
    await expect(fiber).rejects.toThrow(/ENOTDIR/)
  })

  it('boots loud when the user directory is not a directory', async () => {
    const root = await tempDir('user-file')
    await mkdir(join(root, 'catalog'), { recursive: true })
    const user = join(root, 'user')
    await writeFile(user, 'not a dir')
    const ctx = new Context()
    await track(ctx.plugin(McpRegistry))
    await track(ctx.plugin(McpManager, { mcpDir: join(root, '.mcp') }))
    const fiber = ctx.plugin(Connectors, { catalogDir: join(root, 'catalog'), userDir: user })
    track(fiber)
    await expect(fiber).rejects.toThrow(/ENOTDIR/)
  })

  it('sorts multiple customs and override documents at boot', async () => {
    const custom = (id: string) => JSON.stringify({
      id,
      name: id,
      description: 'A local server.',
      presetId: id,
      workspaceDirName: id,
      servers: [{ serverName: id, transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' }],
      auth: [],
    })
    const { ctx } = await boot({
      userDirFiles: [
        ['custom-b.json', custom('custom-b')],
        ['custom-a.json', custom('custom-a')],
        ['atlas.json', JSON.stringify({ url: 'https://a.atlassian.net' })],
        ['notion.json', JSON.stringify({ clientId: 'x' })],
      ],
    })
    const ids = (await ctx.connectors.list()).map(view => view.id)
    expect(ids).toContain('custom-a')
    expect(ids).toContain('custom-b')
    expect(ids).toEqual([...ids].sort())
  })
})

describe('mount failure states', () => {
  it('reports error when a slot references a credential the token method does not declare', async () => {
    const { ctx } = await boot()
    await ctx.connectors.configure('mislabeled', { token: 't' })
    const view = await ctx.connectors.get('mislabeled')
    expect(view?.state).toBe('error')
    expect(view?.lastError).toContain('OTHER_MISSING')
  })
})

describe('state fan-out', () => {
  it('does not fail a committed operation when a listener throws, and later listeners still run', async () => {
    const { ctx } = await boot()
    ctx.on('connector/state', () => {
      throw new Error('sync observer boom')
    })
    const second = vi.fn()
    ctx.on('connector/state', second)
    await expect(ctx.connectors.configure('notion', { token: 'sekret' })).resolves.toBeUndefined()
    expect(second).toHaveBeenCalledWith('notion', 'connected')
    expect(await stateOf(ctx, 'notion')).toBe('connected')
  })

  it('contains an async listener rejection', async () => {
    const { ctx } = await boot()
    // An unknown-returning function keeps the typed surface legal while the
    // runtime value is still the rejected promise the containment must handle.
    const boom = (): unknown => Promise.reject(new Error('async observer boom'))
    ctx.on('connector/state', boom)
    await expect(ctx.connectors.configure('notion', { token: 'sekret' })).resolves.toBeUndefined()
    expect(await stateOf(ctx, 'notion')).toBe('connected')
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  })

  it('rethrows an invariant-coded failure after every listener ran', async () => {
    const { ctx } = await boot()
    const ran: string[] = []
    ctx.on('connector/state', () => {
      ran.push('sync-boom')
      throw new Error('sync observer boom')
    })
    const asyncBoom = (): unknown => {
      ran.push('async-boom')
      return Promise.reject(new Error('async observer boom'))
    }
    ctx.on('connector/state', asyncBoom)
    ctx.on('connector/state', () => {
      ran.push('invariant')
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    const fourth = vi.fn()
    ctx.on('connector/state', fourth)
    await expect(ctx.connectors.configure('notion', { token: 'sekret' }))
      .rejects.toThrow(/forged relation/)
    expect(ran).toEqual(['sync-boom', 'async-boom', 'invariant'])
    expect(fourth).toHaveBeenCalledWith('notion', 'connected')
    // The operation committed before the fan-out threw.
    expect(await stateOf(ctx, 'notion')).toBe('connected')
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  })
})

describe('missing seams', () => {
  it('refuses operations that need a seam the deployment does not compose', async () => {
    const { ctx } = await boot({ withCredentials: false, withPresets: false })
    const views = await ctx.connectors.list()
    expect(views.map(view => view.id)).toEqual(['atlas', 'duo', 'google', 'm365', 'mislabeled', 'notion'])
    await expect(ctx.connectors.configure('notion', { token: 'x' })).rejects.toThrow(ConnectorSeamUnavailableError)
    await expect(ctx.connectors.addCustom({ name: 'X', transport: 'streamable-http', url: 'http://x/mcp' }))
      .rejects.toThrow(ConnectorSeamUnavailableError)
    // A url-only configure needs no credentials seam.
    await ctx.connectors.configure('atlas', { url: 'https://x.atlassian.net' })
    const view = await ctx.connectors.get('atlas')
    expect(view?.state).toBe('unconfigured')
  })
})

describe('user directory at boot', () => {
  it('loads a persisted custom manifest as a custom connector', async () => {
    const custom = JSON.stringify({
      id: 'custom-local',
      name: 'Local',
      description: 'A local server.',
      presetId: 'custom-local',
      workspaceDirName: 'local',
      servers: [{ serverName: 'custom-local', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' }],
      auth: [],
    })
    const { ctx } = await boot({ userDirFiles: [['custom-local.json', custom]] })
    const view = await ctx.connectors.get('custom-local')
    expect(view?.custom).toBe(true)
  })

  it('boots loud when a custom manifest declares a different id than its file', async () => {
    const custom = JSON.stringify({
      id: 'custom-mismatch',
      name: 'X',
      description: 'X',
      presetId: 'custom-mismatch',
      workspaceDirName: 'x',
      servers: [{ serverName: 'custom-x', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' }],
      auth: [],
    })
    const root = await tempDir('mismatch')
    const userDir = join(root, 'user')
    await mkdir(userDir, { recursive: true, mode: 0o700 })
    await writeFile(join(userDir, 'custom-file.json'), custom, { mode: 0o600 })
    const ctx = new Context()
    const f1 = ctx.plugin(McpRegistry)
    fibers.push(f1)
    await f1
    const f2 = ctx.plugin(McpManager, { mcpDir: join(root, '.mcp') })
    fibers.push(f2)
    await f2
    const f3 = ctx.plugin(Connectors, { catalogDir: join(root, 'catalog'), userDir })
    await expect(f3).rejects.toThrow(/declares id/)
  })
})
