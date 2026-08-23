/**
 * Engine suite for the connector OAuth flow: discovery (RFC 9728/8414),
 * dynamic client registration and byoApp clients, PKCE, the loopback
 * callback, the token exchange and refresh, and the connectors seams the
 * engine settles through. In-process fake authorization servers play the
 * provider; a fake mcp-manager service stands in for the mount seam so the
 * suite never spawns a process. The SDK-mocked end-to-end mount through a
 * stored bundle lives in the connectors suite.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { McpServerExistsError, type McpServerSpec } from '@deepseek-ai/dsh-mcp-manager'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import OAuthTokenStore from '@deepseek-ai/dsh-credentials-oauth-tokens'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Connectors from '@deepseek-ai/dsh-connectors'
import OAuthFlowEngine, { type Config as FlowConfig } from '../src/index.ts'

type McpServerView = { serverName: string; status: 'connecting' | 'connected' | 'reconnecting' | 'down'; tools: readonly unknown[] }

/**
 * Mount seam for the suite: records the server specs the connectors service
 * hands over and reports every mounted server as connected.
 */
class FakeMcpManager extends Service {
  readonly specs: McpServerSpec[] = []
  readonly removed: string[] = []
  private mounted: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'mcpManager')
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield () => {
      this.mounted = []
      this.specs.length = 0
      this.removed.length = 0
    }
  }

  mountFailure: Error | null = null

  add = (spec: McpServerSpec): Promise<void> => {
    if (this.mountFailure !== null) return Promise.reject(this.mountFailure)
    if (this.mounted.includes(spec.serverName)) return Promise.reject(new McpServerExistsError(`fake-manager: server "${spec.serverName}" is already managed`))
    this.mounted = [...this.mounted, spec.serverName].sort()
    this.specs.push(spec)
    return Promise.resolve()
  }

  remove = (serverName: string): Promise<void> => {
    const index = this.specs.findIndex(entry => entry.serverName === serverName)
    if (index !== -1) this.specs.splice(index, 1)
    this.mounted = this.mounted.filter(name => name !== serverName)
    this.removed.push(serverName)
    return Promise.resolve()
  }

  servers = (): readonly McpServerView[] => this.specs.map(spec => ({
    serverName: spec.serverName,
    status: 'connected' as const,
    tools: [],
  }))

  userServers = (): readonly string[] => this.mounted
}

const SERVER_URL = 'http://127.0.0.1:1/mcp'

const OAUTH_YML = [
  'id: atlas',
  'name: Atlassian',
  'description: Jira and Confluence.',
  'presetId: atlas',
  'workspaceDirName: atlassian',
  'auth:',
  '  - mode: oauth',
  `    serverUrl: ${SERVER_URL}`,
  'servers:',
  '  - serverName: atlas',
  '    transport: streamable-http',
  `    url: ${SERVER_URL}`,
  '    headers:',
  '      Authorization: { $cred: atlas }',
  '',
].join('\n')

const BYO_YML = [
  'id: byo',
  'name: Byo',
  'description: A pre-registered app.',
  'presetId: byo',
  'workspaceDirName: byo',
  'auth:',
  '  - mode: oauth',
  '    byoApp: true',
  `    serverUrl: ${SERVER_URL}`,
  'servers:',
  '  - serverName: byo',
  '    transport: streamable-http',
  `    url: ${SERVER_URL}`,
  '    headers:',
  '      Authorization: { $cred: byo }',
  '',
].join('\n')

const TOKEN_YML = [
  'id: notion',
  'name: Notion',
  'description: Read and write Notion.',
  'presetId: notion',
  'workspaceDirName: notion',
  'auth:',
  '  - mode: token',
  '    credentialRefs: [NOTION_API_TOKEN]',
  'servers:',
  '  - serverName: notion',
  '    transport: stdio',
  '    command: node',
  '    args: [fixture]',
  '',
].join('\n')

function oauthYml(id: string, serverUrl: string): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'description: A test connector.',
    `presetId: ${id}`,
    `workspaceDirName: ${id}`,
    'auth:',
    '  - mode: oauth',
    `    serverUrl: ${serverUrl}`,
    'servers:',
    `  - serverName: ${id}`,
    '    transport: streamable-http',
    `    url: ${serverUrl}`,
    '    headers:',
    `      Authorization: { $cred: ${id} }`,
    '',
  ].join('\n')
}

interface FakeState {
  tokenBody: (params: URLSearchParams) => unknown
  registerStatus: number
  registerBody: Record<string, unknown>
  seenRegistration: Record<string, unknown>
  seenToken: URLSearchParams[]
  challenge: 'resource-metadata' | 'plain-401'
  metadataOk: boolean
  asMissingEndpoints: boolean
  noRegistration: boolean
}

interface FakeAs extends FakeState {
  url: string
  server: Server
  close(): Promise<void>
}

/** One in-process provider: MCP endpoint, resource + server metadata, DCR, token. */
async function startFakeAs(overrides: Partial<FakeState> = {}): Promise<FakeAs> {
  const server = createServer((request, response) => {
    const address = server.address() as { port: number }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${address.port}`)
    const json = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      response.end(JSON.stringify(body))
    }
    const asMetadata = (): Record<string, unknown> => ({
      issuer: `http://127.0.0.1:${address.port}/as`,
      authorization_endpoint: `http://127.0.0.1:${address.port}/as/authorize`,
      token_endpoint: `http://127.0.0.1:${address.port}/as/token`,
      ...(state.noRegistration ? {} : { registration_endpoint: `http://127.0.0.1:${address.port}/as/register` }),
    })
    if (request.method === 'POST' && (url.pathname === '/mcp' || url.pathname === '/')) {
      if (state.challenge === 'plain-401') {
        response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end()
        return
      }
      json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': `Bearer resource_metadata="http://127.0.0.1:${address.port}/meta"` })
      return
    }
    if (request.method === 'GET' && url.pathname === '/meta') {
      if (!state.metadataOk) { json(500, { error: 'boom' }); return }
      json(200, { resource: '/mcp', authorization_servers: [`http://127.0.0.1:${address.port}/as`] })
      return
    }
    const wellKnown = '/.well-known/oauth-authorization-server'
    if (request.method === 'GET' && (url.pathname === `${wellKnown}/as` || url.pathname === `${wellKnown}/mcp` || url.pathname === wellKnown)) {
      if (!state.metadataOk) { json(500, { error: 'boom' }); return }
      if (state.asMissingEndpoints) { json(200, { issuer: `http://127.0.0.1:${address.port}/as` }); return }
      json(200, asMetadata())
      return
    }
    if (request.method === 'POST' && url.pathname === '/as/register') {
      let body = ''
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        state.seenRegistration = JSON.parse(body) as Record<string, unknown>
        json(state.registerStatus, state.registerBody)
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/as/token') {
      let body = ''
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        const params = new URLSearchParams(body)
        state.seenToken.push(params)
        const result = state.tokenBody(params)
        if (result instanceof Error) { json(400, { error: result.message }); return }
        if (result === 'null-json') {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end('null')
          return
        }
        json(200, result)
      })
      return
    }
    json(404, { error: `no route ${request.method} ${url.pathname}` })
  })
  const state: FakeAs = {
    tokenBody: () => ({ access_token: 'at-1', expires_in: 1800, refresh_token: 'rt-1', scope: 'read' }),
    registerStatus: 200,
    registerBody: { client_id: 'dc-client-1' },
    seenRegistration: {},
    seenToken: [],
    challenge: 'resource-metadata',
    metadataOk: true,
    asMissingEndpoints: false,
    noRegistration: false,
    ...overrides,
    url: '',
    server,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error?: unknown) => {
        if (error instanceof Error) rejectClose(error); else resolveClose()
      })
    }),
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  state.url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`
  return state
}

const cleanups: Array<() => Promise<void>> = []
const fibers: Array<{ dispose: () => Promise<void> }> = []

afterEach(async () => {
  while (fibers.length > 0) await fibers.pop()!.dispose()
  while (cleanups.length > 0) await cleanups.pop()!()
  vi.unstubAllEnvs()
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-oauth-flow-${prefix}-`))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function track<T extends { dispose: () => Promise<void> }>(fiber: T): T {
  fibers.push(fiber)
  return fiber
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error?: unknown) => {
      if (error instanceof Error) rejectClose(error); else resolveClose()
    })
  })
  return port
}

interface BootOptions {
  withTokens?: boolean
  withCredentials?: boolean
  port?: number
  flowTimeoutMs?: number
  extraCatalog?: Array<[string, string]>
}

async function boot(
  fake: { url: string },
  options: BootOptions = {},
): Promise<{ ctx: Context; engine: OAuthFlowEngine; tokensFiber: { dispose: () => Promise<void> } | null; manager: FakeMcpManager }> {
  const root = await tempDir('root')
  const catalogDir = join(root, 'catalog')
  const userDir = join(root, 'user')
  const systemPresets = join(root, 'presets')
  await mkdir(catalogDir, { recursive: true })
  await mkdir(join(systemPresets, 'custom'), { recursive: true })
  await writeFile(join(catalogDir, 'atlas.yml'), OAUTH_YML.replaceAll(SERVER_URL, fake.url))
  await writeFile(join(catalogDir, 'byo.yml'), BYO_YML.replaceAll(SERVER_URL, fake.url))
  await writeFile(join(catalogDir, 'notion.yml'), TOKEN_YML)
  for (const [name, content] of options.extraCatalog ?? []) {
    await writeFile(join(catalogDir, `${name}.yml`), content)
  }
  await writeFile(join(systemPresets, 'custom', 'agent.cordis.yml'), '- id: stub\n  name: test:stub-preset\n')
  const home = await tempDir('home')
  vi.stubEnv('DSH_HOME', home)

  const ctx = new Context()
  await track(ctx.plugin(Loader))
  ctx.loader.builtins.include = Include
  await track(ctx.plugin(SystemPrompt))
  await track(ctx.plugin(ToolRuntime))
  if (options.withCredentials ?? true) {
    await track(ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false }))
  }
  const tokensFiber = (options.withTokens ?? true)
    ? track(ctx.plugin(OAuthTokenStore, { path: join(root, 'tokens.json'), watch: false }))
    : null
  await track(ctx.plugin(AgentPresets, {
    default: 'custom',
    roots: [{ path: systemPresets, trust: 'system' }],
    includeUserRoot: true,
  }))
  new FakeMcpManager(ctx)
  await track(ctx.plugin(Connectors, { catalogDir, userDir }))
  const flowConfig: FlowConfig = {
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.flowTimeoutMs !== undefined ? { flowTimeoutMs: options.flowTimeoutMs } : {}),
  }
  await track(ctx.plugin(OAuthFlowEngine, flowConfig))
  const manager = ctx.mcpManager as unknown as FakeMcpManager
  return { ctx, engine: ctx.oauthFlow as OAuthFlowEngine, tokensFiber, manager }
}

async function poll(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
}

async function viewOf(ctx: Context, id: string): Promise<{ state: string; lastError?: string }> {
  const view = await ctx.connectors.get(id)
  if (view === undefined) throw new Error(`no view for ${id}`)
  return view
}

/** Drive the loopback callback as the provider redirect would. */
async function completeFlow(port: number, authorizationUrl: string, overrides: Record<string, string> = {}): Promise<Response> {
  const state = new URL(authorizationUrl).searchParams.get('state') as string
  const query = new URLSearchParams({ code: 'the-code', state, ...overrides })
  return fetch(`http://127.0.0.1:${port}/callback?${query.toString()}`)
}

describe('begin: discovery and registration', () => {
  it('runs discovery, DCR, and PKCE, and the loopback exchange stores and mounts', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })

    const start = await engine.begin('atlas')
    const url = new URL(start.authorizationUrl)
    const fakePort = (fake.server.address() as { port: number }).port
    expect(url.origin + url.pathname).toBe(`http://127.0.0.1:${fakePort}/as/authorize`)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('dc-client-1')
    expect(url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/callback`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{48}$/)
    expect(url.searchParams.get('code_challenge')).toHaveLength(43)
    expect(fake.seenRegistration).toEqual({
      client_name: 'DeepSeek Harness',
      redirect_uris: [`http://127.0.0.1:${port}/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
    expect(start.expiresAt).toBeGreaterThan(Date.now())
    expect((await viewOf(ctx, 'atlas')).state).toBe('authorizing')

    const response = await completeFlow(port, start.authorizationUrl)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Authorization complete')
    await poll(async () => ctx.oauthTokens.get('atlas') !== undefined, 'token bundle')
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'connected'), 'connected')
    const bundle = ctx.oauthTokens.get('atlas')
    expect(bundle?.accessToken).toBe('at-1')
    expect(bundle?.tokenEndpoint).toBe(`http://127.0.0.1:${fakePort}/as/token`)
    expect(bundle?.clientId).toBe('dc-client-1')
    expect(bundle?.refreshToken).toBe('rt-1')
    expect(bundle?.scope).toBe('read')
    expect(bundle?.expiresAt).toBeGreaterThan(Date.now())

    // The PKCE challenge is the S256 digest of the verifier the exchange sent.
    const params = fake.seenToken[0]
    if (params === undefined) throw new Error('invariant')
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code')).toBe('the-code')
    expect(params.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/callback`)
    expect(params.get('client_id')).toBe('dc-client-1')
    expect(params.has('client_secret')).toBe(false)
    const verifier = params.get('code_verifier') as string
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
  })

  it('defaults the expiry to one hour and drops the missing refresh grant', async () => {
    const fake = await startFakeAs({
      tokenBody: () => ({ access_token: 'at-2' }),
    })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })
    const start = await engine.begin('atlas')
    await completeFlow(port, start.authorizationUrl)
    await poll(() => ctx.oauthTokens.get('atlas') !== undefined, 'token bundle')
    const bundle = ctx.oauthTokens.get('atlas')
    expect(bundle?.accessToken).toBe('at-2')
    expect(bundle?.expiresAt).toBeGreaterThan(Date.now() + 3500_000)
    expect(bundle?.expiresAt).toBeLessThan(Date.now() + 3700_000)
    expect(bundle?.refreshToken).toBeUndefined()
    expect(bundle?.scope).toBeUndefined()
  })

  it('falls back to the well-known metadata under the endpoint path when the challenge names no resource metadata', async () => {
    const fake = await startFakeAs({ challenge: 'plain-401' })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })
    const start = await engine.begin('atlas')
    expect(new URL(start.authorizationUrl).searchParams.get('client_id')).toBe('dc-client-1')
    engine.cancel('atlas')
    expect((await viewOf(ctx, 'atlas')).state).toBe('unconfigured')
  })

  it('uses the bare origin well-known for a root-path endpoint', async () => {
    const fake = await startFakeAs({ challenge: 'plain-401' })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const fakePort = (fake.server.address() as { port: number }).port
    const rootUrl = `http://127.0.0.1:${fakePort}/`
    const { engine } = await boot(fake, { port, extraCatalog: [['root', oauthYml('root', rootUrl)]] })
    const start = await engine.begin('root')
    expect(new URL(start.authorizationUrl).searchParams.get('client_id')).toBe('dc-client-1')
    engine.cancel('root')
  })

  it('throws when the endpoint answers without a challenge', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const bare = createServer((_request, response) => { response.writeHead(404).end() })
    await new Promise<void>((resolveListen) => {
      bare.listen(0, '127.0.0.1', () => { resolveListen() })
    })
    cleanups.push(() => new Promise<void>((resolveClose, rejectClose) => {
      bare.close((error?: unknown) => {
        if (error instanceof Error) rejectClose(error); else resolveClose()
      })
    }))
    const bareUrl = `http://127.0.0.1:${(bare.address() as { port: number }).port}/mcp`
    const { engine } = await boot(fake, { port, extraCatalog: [['bare', oauthYml('bare', bareUrl)]] })
    await expect(engine.begin('bare')).rejects.toThrow('not an OAuth-protected MCP server')
  })

  it('fails when the resource metadata names no authorization server, in each malformed shape', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    let meta: { authorization_servers?: unknown } = { authorization_servers: [] }
    const server = createServer((request, response) => {
      const host = (request.headers.host ?? '').split(':').pop() as string
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${host}`)
      if (request.method === 'POST' && url.pathname === '/mcp') {
        response.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="http://127.0.0.1:${host}/meta"` }).end()
        return
      }
      if (request.method === 'GET' && url.pathname === '/meta') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(meta))
        return
      }
      response.writeHead(404).end()
    })
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', () => { resolveListen() })
    })
    cleanups.push(() => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error?: unknown) => {
        if (error instanceof Error) rejectClose(error); else resolveClose()
      })
    }))
    const emptyUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`
    const { engine } = await boot(fake, { port, extraCatalog: [['emptyas', oauthYml('emptyas', emptyUrl)]] })
    for (const shaped of [{ authorization_servers: 'nope' }, { authorization_servers: [42] }, { authorization_servers: [] }] as const) {
      meta = shaped
      await expect(engine.begin('emptyas')).rejects.toThrow('names no authorization server')
    }
  })

  it('fails when the authorization server metadata lacks the endpoints', async () => {
    const fake = await startFakeAs({ asMissingEndpoints: true })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port })
    await expect(engine.begin('atlas')).rejects.toThrow('missing authorization_endpoint or token_endpoint')
  })

  it('fails when a metadata fetch is refused', async () => {
    const fake = await startFakeAs({ metadataOk: false })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port })
    await expect(engine.begin('atlas')).rejects.toThrow('GET')
  })

  it('fails when the probe cannot reach the endpoint', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const dead = await freePort()
    const deadUrl = `http://127.0.0.1:${dead}/mcp`
    const { engine } = await boot(fake, { port, extraCatalog: [['dead', oauthYml('dead', deadUrl)]] })
    await expect(engine.begin('dead')).rejects.toThrow()
  })

  it('refuses a dynamic registration that is refused or carries no client id', async () => {
    const fake = await startFakeAs({ registerStatus: 403 })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port })
    await expect(engine.begin('atlas')).rejects.toThrow('dynamic client registration was refused')
    fake.registerStatus = 200
    fake.registerBody = {}
    await expect(engine.begin('atlas')).rejects.toThrow('carries no client_id')
  })

  it('refuses a non-byoApp provider without dynamic registration', async () => {
    const fake = await startFakeAs({ noRegistration: true })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port })
    await expect(engine.begin('atlas')).rejects.toThrow('no dynamic client registration')
  })

  it('uses the pre-registered app for a byoApp method, with or without a secret', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })

    await expect(engine.begin('byo')).rejects.toThrow('needs its pre-registered client id')
    await ctx.connectors.configure('byo', { clientId: 'byo-client', clientSecret: 'byo-secret' })
    const start = await engine.begin('byo')
    expect(new URL(start.authorizationUrl).searchParams.get('client_id')).toBe('byo-client')
    await completeFlow(port, start.authorizationUrl)
    await poll(() => ctx.oauthTokens.get('byo') !== undefined, 'byo bundle')
    const seen = fake.seenToken[0]
    if (seen === undefined) throw new Error('invariant')
    expect(seen.get('client_id')).toBe('byo-client')
    expect(seen.get('client_secret')).toBe('byo-secret')
    expect(ctx.oauthTokens.get('byo')?.clientId).toBe('byo-client')
  })

  it('omits the client secret for a byoApp app without one', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })
    await ctx.connectors.configure('byo', { clientId: 'byo-client' })
    const start = await engine.begin('byo')
    await completeFlow(port, start.authorizationUrl)
    await poll(() => ctx.oauthTokens.get('byo') !== undefined, 'byo bundle')
    const seen2 = fake.seenToken[0]
    if (seen2 === undefined) throw new Error('invariant')
    expect(seen2.has('client_secret')).toBe(false)
    expect(ctx.oauthTokens.get('byo')?.clientId).toBe('byo-client')
  })
})

describe('begin: guards', () => {
  it('refuses unknown connectors and token-only connectors', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port })
    await expect(engine.begin('nope')).rejects.toThrow('unknown connector')
    await expect(engine.begin('notion')).rejects.toThrow('supports no oauth auth')
  })

  it('refuses a deployment without the token store', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port, withTokens: false })
    await expect(engine.begin('atlas')).rejects.toThrow('composes no oauth-tokens store')
  })

  it('refuses a byoApp method on a deployment without the credentials seam', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port, withCredentials: false })
    await ctx.connectors.configure('byo', { clientId: 'byo-client' })
    await expect(engine.begin('byo')).rejects.toThrow('composes no credentials service')
  })

  it('records a failure when the loopback port is taken', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const blocker = createServer()
    await new Promise<void>((resolveListen) => {
      blocker.listen(port, '127.0.0.1', () => { resolveListen() })
    })
    cleanups.push(() => new Promise<void>((resolveClose, rejectClose) => {
      blocker.close((error?: unknown) => {
        if (error instanceof Error) rejectClose(error); else resolveClose()
      })
    }))
    const { ctx, engine } = await boot(fake, { port })
    await expect(engine.begin('atlas')).rejects.toThrow('loopback callback port')
    expect((await viewOf(ctx, 'atlas')).state).toBe('unconfigured')
  })

  it('throws on a second begin while a flow is in flight', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port })
    await engine.begin('atlas')
    await expect(engine.begin('atlas')).rejects.toThrow('already in flight')
    engine.cancel('atlas')
  })

  it('binds the default port when none is configured', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const { ctx, engine } = await boot(fake)
    const start = await engine.begin('atlas')
    expect(new URL(start.authorizationUrl).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8766/callback')
    engine.cancel('atlas')
    expect((await viewOf(ctx, 'atlas')).state).toBe('unconfigured')
  })
})

describe('the loopback callback', () => {
  async function flowToPort(): Promise<{ ctx: Context; engine: OAuthFlowEngine; tokensFiber: { dispose: () => Promise<void> } | null; port: number; start: Awaited<ReturnType<OAuthFlowEngine['begin']>> }> {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine, tokensFiber } = await boot(fake, { port })
    const start = await engine.begin('atlas')
    return { ctx, engine, tokensFiber, port, start }
  }

  it('answers 404 for foreign paths and methods', async () => {
    const { port } = await flowToPort()
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${port}/callback`, { method: 'POST' })).status).toBe(404)
  })

  it('records a provider error and clears the flow', async () => {
    const { ctx, port, start } = await flowToPort()
    await completeFlow(port, start.authorizationUrl, { error: 'access_denied' })
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toBe('the sign-in was canceled')
  })

  it('surfaces the provider error description when one is given', async () => {
    const { ctx, port, start } = await flowToPort()
    await completeFlow(port, start.authorizationUrl, { error: 'server_error', 'error_description': 'the provider blew up' })
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toBe('the provider blew up')
  })

  it('records a state mismatch and a missing or empty code', async () => {
    const { ctx, engine, port } = await flowToPort()
    await fetch(`http://127.0.0.1:${port}/callback?code=x&state=wrong`)
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toBe('the callback state did not match the flow')

    const again = await engine.begin('atlas')
    const state = new URL(again.authorizationUrl).searchParams.get('state') as string
    await fetch(`http://127.0.0.1:${port}/callback?state=${state}`)
    await poll(async () => ((await viewOf(ctx, 'atlas')).lastError === 'the callback carried no authorization code'), 'no-code error')

    const third = await engine.begin('atlas')
    const thirdState = new URL(third.authorizationUrl).searchParams.get('state') as string
    await fetch(`http://127.0.0.1:${port}/callback?code=&state=${thirdState}`)
    await poll(async () => ((await viewOf(ctx, 'atlas')).lastError === 'the callback carried no authorization code' && (await viewOf(ctx, 'atlas')).state === 'error'), 'empty-code error')
  })

  it('records a refused code exchange without storing a bundle', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })
    fake.tokenBody = () => new Error('invalid_grant')
    const start = await engine.begin('atlas')
    await completeFlow(port, start.authorizationUrl)
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toContain('code exchange was refused')
    expect(ctx.oauthTokens.get('atlas')).toBeUndefined()
  })

  it('records a token response without an access token', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })
    fake.tokenBody = () => ({ refresh_token: 'rt-only' })
    const start = await engine.begin('atlas')
    await completeFlow(port, start.authorizationUrl)
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toContain('carries no access_token')
    expect(ctx.oauthTokens.get('atlas')).toBeUndefined()
  })

  it('records a non-object token response', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port })
    fake.tokenBody = () => 'null-json'
    const start = await engine.begin('atlas')
    await completeFlow(port, start.authorizationUrl)
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toContain('was not an object')
  })

  it('keeps the stored bundle when the post-exchange mount fails', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine, manager } = await boot(fake, { port })
    manager.mountFailure = new Error('mount refused')
    const start = await engine.begin('atlas')
    await completeFlow(port, start.authorizationUrl)
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toContain('mount refused')
    expect(ctx.oauthTokens.get('atlas')?.accessToken).toBe('at-1')
  })

  it('records a failure when the token store disappears mid-flow', async () => {
    const { ctx, tokensFiber, port, start } = await flowToPort()
    if (tokensFiber === null) throw new Error('the test boots with the token store')
    await tokensFiber.dispose()
    await completeFlow(port, start.authorizationUrl)
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'error state')
    expect((await viewOf(ctx, 'atlas')).lastError).toBe('the deployment composes no oauth-tokens store')
  })

  it('gives up when the authorization window closes', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx, engine } = await boot(fake, { port, flowTimeoutMs: 1000 })
    await engine.begin('atlas')
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'timeout error')
    expect((await viewOf(ctx, 'atlas')).lastError).toBe('the authorization window closed before the sign-in finished')
    expect(ctx.oauthTokens.get('atlas')).toBeUndefined()
  })

  it('refuses a callback that arrives after the flow was canceled', async () => {
    const { ctx, engine, port, start } = await flowToPort()
    const state = new URL(start.authorizationUrl).searchParams.get('state') as string
    expect((await viewOf(ctx, 'atlas')).state).toBe('authorizing')
    engine.cancel('atlas')
    // The cancel tears the loopback listener down, so a late redirect has no
    // listener left to answer — the refusal is the closed-port connection
    // error, not an HTTP response.
    const refused = await fetch(`http://127.0.0.1:${port}/callback?code=late&state=${state}`).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(Error)
    await poll(async () => ((await viewOf(ctx, 'atlas')).state !== 'authorizing'), 'flow cleared')
    expect((await viewOf(ctx, 'atlas')).state).toBe('unconfigured')
  })

  it('cancels a flow without recording an error', async () => {
    const { ctx, engine } = await flowToPort()
    engine.cancel('atlas')
    expect((await viewOf(ctx, 'atlas')).state).toBe('unconfigured')
    expect((await viewOf(ctx, 'atlas')).lastError).toBeUndefined()
  })

  it('records a loopback listener failure after the bind succeeded', async () => {
    const { ctx, engine } = await flowToPort()
    // Test-only reach into the engine's in-flight flow to fire the post-listen
    // server error listener; no public seam drives that listener.
    const flow = (engine as unknown as { inFlight: Map<string, { server: Server }> }).inFlight.get('atlas')
    if (flow === undefined) throw new Error('the flow should be in flight')
    flow.server.emit('error', new Error('listener died'))
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'error'), 'listener error')
    expect((await viewOf(ctx, 'atlas')).lastError).toBe('the loopback callback listener failed (listener died)')
  })

  it('tears down an in-flight flow on disposal', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { engine } = await boot(fake, { port })
    await engine.begin('atlas')
    expect(await portIsFree(port)).toBe(false)
    void fibers.pop()!.dispose()
    await new Promise(resolveWait => setTimeout(resolveWait, 50))
    expect(await portIsFree(port)).toBe(true)
  })
})

async function portIsFree(port: number): Promise<boolean> {
  const probe = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(port, '127.0.0.1', () => { resolve() })
    })
    await new Promise<void>((resolveClose, rejectClose) => {
      probe.close((error?: unknown) => {
        if (error instanceof Error) rejectClose(error); else resolveClose()
      })
    })
    return true
  } catch {
    return false
  }
}

describe('ensureFresh and the connectors connect seam', () => {
  it('rejects an oauth connect without a stored bundle', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    await expect(ctx.connectors.connect('atlas', 'oauth')).rejects.toThrow('has no stored token')
  })

  it('mounts through the stored bundle when the access token is fresh', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    const now = Date.now()
    await ctx.oauthTokens.put('atlas', {
      accessToken: 'fresh',
      expiresAt: now + 3_600_000,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      refreshToken: 'rt',
      clientId: 'dc-client-1',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.connectors.connect('atlas', 'oauth')
    expect((await viewOf(ctx, 'atlas')).state).toBe('connected')
    expect(fake.seenToken).toHaveLength(0)
  })

  it('refreshes an expiring bundle before mounting', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    const now = Date.now()
    await ctx.oauthTokens.put('atlas', {
      accessToken: 'stale',
      expiresAt: now + 10_000,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      refreshToken: 'rt-stale',
      clientId: 'dc-client-1',
      createdAt: now - 86_400_000,
      updatedAt: now,
    })
    await ctx.connectors.connect('atlas', 'oauth')
    await poll(async () => ((await viewOf(ctx, 'atlas')).state === 'connected'), 'connected')
    const params = fake.seenToken[0]
    if (params === undefined) throw new Error('invariant')
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('rt-stale')
    expect(params.get('client_id')).toBe('dc-client-1')
    expect(params.has('client_secret')).toBe(false)
    const bundle = ctx.oauthTokens.get('atlas')
    expect(bundle?.accessToken).toBe('at-1')
    expect(bundle?.createdAt).toBe(now - 86_400_000)
    expect(bundle?.refreshToken).toBe('rt-1')
    expect(bundle?.scope).toBe('read')
  })

  it('carries the refresh token and scope through a refresh that omits them', async () => {
    const fake = await startFakeAs({
      tokenBody: () => ({ access_token: 'at-refreshed' }),
    })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    const now = Date.now()
    await ctx.oauthTokens.put('atlas', {
      accessToken: 'stale',
      expiresAt: now,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      refreshToken: 'rt-keep',
      scope: 'kept-scope',
      clientId: 'dc-client-1',
      createdAt: now,
      updatedAt: now,
    })
    const flowRefresh = ctx.oauthFlow
    if (flowRefresh === undefined) throw new Error('invariant')
    await expect(flowRefresh.ensureFresh('atlas')).resolves.toBeUndefined()
    const bundle = ctx.oauthTokens.get('atlas')
    expect(bundle?.accessToken).toBe('at-refreshed')
    expect(bundle?.refreshToken).toBe('rt-keep')
    expect(bundle?.scope).toBe('kept-scope')
  })

  it('refreshes a byoApp bundle with its stored client secret', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    await ctx.connectors.configure('byo', { clientId: 'byo-client', clientSecret: 'byo-secret' })
    const now = Date.now()
    await ctx.oauthTokens.put('byo', {
      accessToken: 'stale',
      expiresAt: now,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      refreshToken: 'rt-byo',
      clientId: 'byo-client',
      createdAt: now,
      updatedAt: now,
    })
    const flowByo = ctx.oauthFlow
    if (flowByo === undefined) throw new Error('invariant')
    await expect(flowByo.ensureFresh('byo')).resolves.toBeUndefined()
    const seen = fake.seenToken[0]
    if (seen === undefined) throw new Error('invariant')
    expect(seen.get('client_secret')).toBe('byo-secret')
    expect(ctx.oauthTokens.get('byo')?.accessToken).toBe('at-1')
  })

  it('refreshes without a secret on a deployment without the credentials seam', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port, withCredentials: false })
    const now = Date.now()
    await ctx.oauthTokens.put('byo', {
      accessToken: 'stale',
      expiresAt: now,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      refreshToken: 'rt-byo',
      clientId: 'byo-client',
      createdAt: now,
      updatedAt: now,
    })
    const flowByo = ctx.oauthFlow
    if (flowByo === undefined) throw new Error('invariant')
    await expect(flowByo.ensureFresh('byo')).resolves.toBeUndefined()
    const seen2 = fake.seenToken[0]
    if (seen2 === undefined) throw new Error('invariant')
    expect(seen2.has('client_secret')).toBe(false)
    expect(ctx.oauthTokens.get('byo')?.accessToken).toBe('at-1')
  })

  it('reports a lapsed grant without a refresh token for re-authorization', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    const now = Date.now()
    await ctx.oauthTokens.put('atlas', {
      accessToken: 'stale',
      expiresAt: now,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      clientId: 'dc-client-1',
      createdAt: now,
      updatedAt: now,
    })
    const flowAtlas = ctx.oauthFlow
    if (flowAtlas === undefined) throw new Error('invariant')
    await expect(flowAtlas.ensureFresh('atlas')).rejects.toThrow('no refresh grant; re-authorize')
  })

  it('reports a refused refresh', async () => {
    const fake = await startFakeAs({ tokenBody: () => new Error('invalid_grant') })
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    const now = Date.now()
    await ctx.oauthTokens.put('atlas', {
      accessToken: 'stale',
      expiresAt: now,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      refreshToken: 'rt',
      clientId: 'dc-client-1',
      createdAt: now,
      updatedAt: now,
    })
    const flowRefused = ctx.oauthFlow
    if (flowRefused === undefined) throw new Error('invariant')
    await expect(flowRefused.ensureFresh('atlas')).rejects.toThrow('token refresh was refused')
  })

  it('refuses a bundle that records no client id', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port })
    const now = Date.now()
    await ctx.oauthTokens.put('atlas', {
      accessToken: 'stale',
      expiresAt: now,
      tokenEndpoint: `http://127.0.0.1:${(fake.server.address() as { port: number }).port}/as/token`,
      refreshToken: 'rt',
      createdAt: now,
      updatedAt: now,
    })
    const flow = ctx.oauthFlow
    if (flow === undefined) throw new Error('invariant: the engine must be present')
    await expect(flow.ensureFresh('atlas')).rejects.toThrow('records no client id')
  })

  it('refuses a deployment without the token store', async () => {
    const fake = await startFakeAs()
    cleanups.push(() => fake.close())
    const port = await freePort()
    const { ctx } = await boot(fake, { port, withTokens: false })
    const flow = ctx.oauthFlow
    if (flow === undefined) throw new Error('invariant: the engine must be present')
    await expect(flow.ensureFresh('atlas')).rejects.toThrow('composes no oauth-tokens store')
  })
})
