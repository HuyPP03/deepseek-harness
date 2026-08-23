/**
 * The connector OAuth flow engine (`ctx.oauthFlow`): the host-side half of an
 * `oauth` auth method. `begin` drives provider discovery (RFC 9728 protected
 * resource metadata named by the endpoint's 401 challenge, then RFC 8414
 * authorization-server metadata), client registration (dynamic client
 * registration, or the user's pre-registered app for `byoApp` methods), PKCE,
 * and a loopback callback server; the exchange's token bundle lands in the
 * `oauth-tokens` store under the connector id, which the mcp-client seam
 * presents as the bearer for the connector's servers. `ensureFresh` refreshes
 * an expiring bundle before a mount, so a re-authorization only happens when
 * the provider's grant actually lapsed.
 * @module @deepseek-ai/dsh-connectors-oauth-flow
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import { clientSecretRef, type Connectors, type OauthAuthMethod } from '@deepseek-ai/dsh-connectors'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { OAuthTokenBundle } from '@deepseek-ai/dsh-credentials-oauth-tokens'
import z from '@deepseek-ai/schemastery'
import type { OAuthFlowStart } from './types.ts'

export type { OAuthFlowStart } from './types.ts'

/** The loopback path the redirect URI points at. */
const CALLBACK_PATH = '/callback'
/** The registered client's display name at dynamic registration. */
const CLIENT_NAME = 'DeepSeek Harness'
/** Access-token slack before `ensureFresh` treats the bundle as expiring, in milliseconds. */
const REFRESH_SLACK_MS = 60_000

/** Plugin config: the loopback listener and the flow budget. */
export interface Config {
  /** Loopback callback port; defaults to 8766. */
  port?: number
  /** How long one flow may wait for the browser redirect; defaults to 300000 (5 minutes). */
  flowTimeoutMs?: number
}

/** Fully resolved engine parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  port: number
  flowTimeoutMs: number
}

function resolveSpec(config: Config): ResolvedSpec {
  return {
    port: config.port ?? 8766,
    flowTimeoutMs: config.flowTimeoutMs ?? 300_000,
  }
}

/** One authorization server's RFC 8414 endpoints. */
interface AsEndpoints {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
}

/** The in-flight half of one connector's flow. */
interface InFlight {
  verifier: string
  state: string
  clientId: string
  clientSecret?: string
  redirectUri: string
  tokenEndpoint: string
  server: Server
  timeout: NodeJS.Timeout
}

/**
 * Parse the `resource_metadata` parameter from a `WWW-Authenticate: Bearer`
 * challenge (RFC 9728).
 * @param header - the raw challenge value.
 * @returns the resource metadata URL, or `undefined` when the parameter is absent.
 */
function resourceMetadataFromChallenge(header: string): string | undefined {
  return header.match(/resource_metadata="([^"]+)"/)?.[1]
}

/**
 * The RFC 8414 well-known URL for one authorization server: the server path
 * (tenant path and below) hangs off `/.well-known/oauth-authorization-server`.
 * @param asUrl - the authorization server base URL.
 * @returns the well-known metadata URL.
 */
function wellKnownFor(asUrl: string): string {
  const url = new URL(asUrl)
  return `${url.origin}/.well-known/oauth-authorization-server${url.pathname === '/' ? '' : url.pathname}`
}

/**
 * One PKCE pair: the verifier is a 43-character base64url secret; the
 * challenge is its S256 digest (RFC 7636 §4.2).
 * @returns the pair to send in the authorization request.
 */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/**
 * Drives one connector's browser OAuth flow: RFC 9728 protected-resource
 * discovery, RFC 8414 authorization-server metadata, dynamic client
 * registration, PKCE, and the loopback token exchange. The loopback server
 * is torn down when the flow settles, fails, or is canceled.
 */
export class OAuthFlowEngine extends Service {
  static Config: z<Config> = z.object({
    port: z.number().min(1).max(65535).default(8766),
    flowTimeoutMs: z.number().min(1000).default(300_000),
  })

  private readonly spec: ResolvedSpec
  /** In-flight flows, keyed by connector id: one flow per connector. */
  private readonly inFlight = new Map<string, InFlight>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'oauthFlow')
    this.spec = resolveSpec(config)
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield async () => {
      for (const id of [...this.inFlight.keys()]) this.teardown(id, undefined)
      await Promise.resolve()
    }
    await Promise.resolve()
  }

  /**
   * Begin one connector's browser flow: discovery, client registration, PKCE,
   * and the loopback listener. The returned URL is what a browser tab opens;
   * the exchange completes server-side when the provider redirects back.
   *
   * @param id - the connector id with an `oauth` auth method.
   * @returns the authorization URL and the flow's expiry.
   * @throws when the flow seams are missing, the method is absent, a flow is
   * already in flight, the loopback port is taken, or the provider offers no
   * usable client path.
   */
  async begin(id: string): Promise<OAuthFlowStart> {
    if (this.inFlight.has(id)) throw new Error(`oauth-flow: a flow for "${id}" is already in flight`)
    const connectors = this.requireConnectors()
    const tokens = this.ctx.get('oauthTokens')
    if (tokens === undefined) throw new Error('oauth-flow: the deployment composes no oauth-tokens store')
    const manifest = connectors.manifest(id)
    if (manifest === undefined) throw new Error(`oauth-flow: unknown connector "${id}"`)
    const method = manifest.auth.find(entry => entry.mode === 'oauth')
    if (method === undefined) throw new Error(`oauth-flow: connector "${id}" supports no oauth auth`)

    const redirectUri = `http://127.0.0.1:${this.spec.port}${CALLBACK_PATH}`
    const endpoints = await this.discover(method.serverUrl)
    const { clientId, clientSecret } = await this.registerClient(id, method, endpoints, redirectUri)
    const { verifier, challenge } = pkcePair()
    const state = randomBytes(24).toString('hex')

    const authorizationUrl = new URL(endpoints.authorizationEndpoint)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('client_id', clientId)
    authorizationUrl.searchParams.set('redirect_uri', redirectUri)
    authorizationUrl.searchParams.set('state', state)
    authorizationUrl.searchParams.set('code_challenge', challenge)
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')

    // The server is created before the flow registers so the handler's
    // in-flight lookup already sees it when the first request lands.
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.spec.port}`)
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
        return
      }
      const active = this.inFlight.get(id)
      if (active === undefined) {
        response.writeHead(404, { 'Content-Type': 'text/plain' }).end('the flow is no longer active')
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><meta charset="utf-8"><title>DeepSeek Harness</title><h1>Authorization complete</h1><p>You can close this tab and return to DeepSeek Harness.</p>')
      void this.handleCallback(id, active, url.searchParams)
    })
    const flow: InFlight = {
      verifier, state, clientId,
      ...(clientSecret !== undefined ? { clientSecret } : {}),
      redirectUri, tokenEndpoint: endpoints.tokenEndpoint,
      server,
      timeout: setTimeout(
        () => { this.teardown(id, 'the authorization window closed before the sign-in finished') },
        this.spec.flowTimeoutMs,
      ),
    }
    this.inFlight.set(id, flow)
    connectors.setAuthorizing(id, true)
    try {
      await new Promise<void>((resolve, reject) => {
        flow.server.once('error', reject)
        flow.server.listen(this.spec.port, '127.0.0.1', () => { resolve() })
      })
    } catch (error) {
      this.inFlight.delete(id)
      clearTimeout(flow.timeout)
      connectors.setAuthorizing(id, false)
      throw new Error(`oauth-flow: the loopback callback port ${this.spec.port} is unavailable (${(error as NodeJS.ErrnoException).message})`)
    }
    flow.server.on('error', (error: NodeJS.ErrnoException) => { this.fail(id, `the loopback callback listener failed (${error.message})`) })
    return { authorizationUrl: authorizationUrl.toString(), expiresAt: Date.now() + this.spec.flowTimeoutMs }
  }

  /**
   * Cancel one in-flight flow without recording an error: the loopback stops
   * listening and the authorizing flag clears.
   * @param id - the connector id.
   */
  cancel(id: string): void {
    this.teardown(id, undefined)
  }

  /**
   * Make one stored bundle presentable: refresh it when the access token has
   * expired or is within the refresh slack. A fresh bundle is a no-op.
   * @param id - the connector id owning the bundle.
   * @throws when the store composes no bundle, or the provider refused the refresh.
   */
  async ensureFresh(id: string): Promise<void> {
    const tokens = this.ctx.get('oauthTokens')
    if (tokens === undefined) throw new Error('oauth-flow: the deployment composes no oauth-tokens store')
    const bundle = tokens.get(id)
    if (bundle === undefined) throw new Error(`oauth-flow: the deployment stores no token bundle for "${id}"`)
    if (bundle.expiresAt - REFRESH_SLACK_MS > Date.now()) return
    if (bundle.refreshToken === undefined) {
      throw new Error(`oauth-flow: the token for "${id}" expired and carries no refresh grant; re-authorize the connector`)
    }
    await tokens.put(id, await this.refreshBundle(id, bundle))
  }

  /**
   * The provider's loopback callback: validates the state, exchanges the
   * code, stores the bundle, and mounts through the connectors service, whose
   * token-present branch takes over from there.
   * @param id - the connector id.
   * @param flow - the in-flight flow.
   * @param query - the callback query parameters.
   */
  private async handleCallback(id: string, flow: InFlight, query: URLSearchParams): Promise<void> {
    const error = query.get('error')
    if (error !== null) {
      this.fail(id, error === 'access_denied' ? 'the sign-in was canceled' : (query.get('error_description') ?? error))
      return
    }
    if (query.get('state') !== flow.state) {
      this.fail(id, 'the callback state did not match the flow')
      return
    }
    const code = query.get('code')
    if (code === null || code.length === 0) {
      this.fail(id, 'the callback carried no authorization code')
      return
    }
    const tokens = this.ctx.get('oauthTokens')
    if (tokens === undefined) {
      this.fail(id, 'the deployment composes no oauth-tokens store')
      return
    }
    try {
      await tokens.put(id, await this.exchangeCode(flow, code))
      this.teardown(id, undefined)
      /* v8 ignore next -- the engine cannot begin without the connectors service, so a live callback implies it */
      const connectors = this.requireConnectors()
      await connectors.connect(id, 'oauth')
    } catch (error) {
      this.fail(id, error instanceof Error ? error.message : String(error))
    }
  }

  /** Record the failure and tear down one flow when it is still in flight. */
  private fail(id: string, message: string): void {
    if (this.inFlight.has(id)) this.teardown(id, message)
    else this.recordFailure(id, message)
  }

  /**
   * Record one flow failure on a connector whose flow already settled; a
   * failed publish is logged, not thrown — the recording side cannot fail
   * the browser exchange that already happened.
   * @param id - the connector id.
   * @param message - the failure to surface.
   */
  private recordFailure(id: string, message: string): void {
    const connectors = this.ctx.get('connectors')
    /* v8 ignore next -- the engine cannot begin without the connectors service, so a recorded failure implies it */
    if (connectors === undefined) return
    void connectors.recordFlowFailure(id, message).catch((error: unknown) => {
      /* v8 ignore start -- a failed record cannot roll back the settled browser exchange; the warn answers that torn-down-host tail */
      this.ctx.logger.warn('oauth-flow: recording the flow failure for "%s" failed', id)
      this.ctx.logger.warn(error)
      /* v8 ignore stop */
    })
  }

  /** Remove one flow: clear the flag, stop listening, and record the failure. */
  private teardown(id: string, message: string | undefined): void {
    const flow = this.inFlight.get(id)
    if (flow === undefined) return
    this.inFlight.delete(id)
    clearTimeout(flow.timeout)
    flow.server.close()
    /* v8 ignore next -- disposal drains in reverse boot order, so a live teardown implies the connectors service */
    this.ctx.get('connectors')?.setAuthorizing(id, false)
    if (message !== undefined) this.recordFailure(id, message)
  }

  /**
   * Endpoint discovery: an unauthenticated probe of the MCP endpoint, its
   * 401 challenge (RFC 9728), and the authorization server metadata (RFC 8414).
   * @param serverUrl - the provider MCP endpoint.
   * @returns the resolved endpoints the flow drives against.
   */
  private async discover(serverUrl: string): Promise<AsEndpoints> {
    const probe = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
    })
    const challenge = probe.headers.get('www-authenticate')
    if (challenge === null) {
      throw new Error(`oauth-flow: ${serverUrl} answered without an authentication challenge; the endpoint is not an OAuth-protected MCP server`)
    }
    const resourceMetadata = resourceMetadataFromChallenge(challenge)
    const asUrl = resourceMetadata !== undefined ? await this.firstAuthorizationServer(resourceMetadata) : serverUrl
    const metadataUrl = wellKnownFor(asUrl)
    const metadata = await this.fetchJson<Record<string, unknown>>(metadataUrl)
    const authorizationEndpoint = metadata.authorization_endpoint
    const tokenEndpoint = metadata.token_endpoint
    if (typeof authorizationEndpoint !== 'string' || typeof tokenEndpoint !== 'string') {
      throw new Error(`oauth-flow: the authorization server metadata at ${metadataUrl} is missing authorization_endpoint or token_endpoint`)
    }
    const registrationEndpoint = typeof metadata.registration_endpoint === 'string' ? metadata.registration_endpoint : undefined
    return {
      authorizationEndpoint, tokenEndpoint,
      ...(registrationEndpoint !== undefined ? { registrationEndpoint } : {}),
    }
  }

  /** Fetch the RFC 9728 document and return its first authorization server. */
  private async firstAuthorizationServer(resourceMetadata: string): Promise<string> {
    const doc = await this.fetchJson<Record<string, unknown>>(resourceMetadata)
    const servers = doc.authorization_servers
    if (!Array.isArray(servers) || servers.length === 0 || typeof servers[0] !== 'string') {
      throw new Error(`oauth-flow: the resource metadata at ${resourceMetadata} names no authorization server`)
    }
    return servers[0]
  }

  /**
   * Resolve the flow's client: a `byoApp` method reads the user's
   * pre-registered client id from the override document and its secret from
   * the credentials seam; otherwise dynamic client registration mints one
   * for the loopback redirect.
   * @param id - the connector id.
   * @param method - the oauth method.
   * @param endpoints - the resolved authorization server.
   * @param redirectUri - the loopback redirect URI to register.
   * @returns the client identity the flow presents.
   */
  private async registerClient(
    id: string,
    method: OauthAuthMethod,
    endpoints: AsEndpoints,
    redirectUri: string,
  ): Promise<{ clientId: string; clientSecret?: string }> {
    if (method.byoApp) {
      const connectors = this.requireConnectors()
      const clientId = connectors.overrideClientId(id)
      if (clientId === undefined) {
        throw new Error(`oauth-flow: connector "${id}" needs its pre-registered client id (configure the clientId field first)`)
      }
      const credentials = this.ctx.get('credentials')
      if (credentials === undefined) throw new Error('oauth-flow: the deployment composes no credentials service')
      const secret = await credentials.resolve(credentialRef(clientSecretRef(id)))
      return { clientId, ...(secret !== undefined ? { clientSecret: secret.value } : {}) }
    }
    if (endpoints.registrationEndpoint === undefined) {
      throw new Error('oauth-flow: the provider offers no dynamic client registration and the method is not byoApp; the user must supply a pre-registered app')
    }
    const response = await fetch(endpoints.registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
    if (!response.ok) {
      throw new Error(`oauth-flow: dynamic client registration was refused (${String(response.status)} ${response.statusText})`)
    }
    const registered = await response.json() as Record<string, unknown>
    if (typeof registered.client_id !== 'string' || registered.client_id.length === 0) {
      throw new Error('oauth-flow: the registration response carries no client_id')
    }
    const clientSecret = typeof registered.client_secret === 'string' ? registered.client_secret : undefined
    return { clientId: registered.client_id, ...(clientSecret !== undefined ? { clientSecret } : {}) }
  }

  /** POST the code exchange to the token endpoint and shape the stored bundle. */
  private async exchangeCode(flow: InFlight, code: string): Promise<OAuthTokenBundle> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientId,
      code_verifier: flow.verifier,
    })
    if (flow.clientSecret !== undefined) params.set('client_secret', flow.clientSecret)
    const response = await fetch(flow.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!response.ok) {
      throw new Error(`oauth-flow: the code exchange was refused (${String(response.status)} ${response.statusText})`)
    }
    return this.bundleFrom(await response.json(), flow.tokenEndpoint, flow.clientId)
  }

  /** Refresh one stored bundle through its own token endpoint. */
  /** Refresh one stored bundle through its own token endpoint. */
  private async refreshBundle(id: string, bundle: OAuthTokenBundle): Promise<OAuthTokenBundle> {
    const clientId = bundle.clientId
    if (clientId === undefined) {
      throw new Error('oauth-flow: the stored bundle records no client id; re-authorize the connector')
    }
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: bundle.refreshToken as string,
      client_id: clientId,
    })
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      // The byoApp client secret lives under the connector id's derived reference.
      const secret = await credentials.resolve(credentialRef(clientSecretRef(id)))
      if (secret !== undefined) params.set('client_secret', secret.value)
    }
    const response = await fetch(bundle.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!response.ok) {
      throw new Error(`oauth-flow: the token refresh was refused (${String(response.status)} ${response.statusText})`)
    }
    const next = this.bundleFrom(await response.json(), bundle.tokenEndpoint, clientId, bundle)
    return { ...next, createdAt: bundle.createdAt }
  }

  /** Shape one provider token response into the store's bundle. */
  private bundleFrom(raw: unknown, tokenEndpoint: string, clientId: string, previous?: OAuthTokenBundle): OAuthTokenBundle {
    if (typeof raw !== 'object' || raw === null) throw new Error('oauth-flow: the token response was not an object')
    const doc = raw as Record<string, unknown>
    const accessToken = doc.access_token
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('oauth-flow: the token response carries no access_token')
    }
    const now = Date.now()
    const expiresIn = typeof doc.expires_in === 'number' ? doc.expires_in : 3600
    return {
      accessToken,
      expiresAt: now + expiresIn * 1000,
      tokenEndpoint,
      clientId,
      ...(typeof doc.refresh_token === 'string' ? { refreshToken: doc.refresh_token } : previous !== undefined && previous.refreshToken !== undefined ? { refreshToken: previous.refreshToken } : {}),
      ...(typeof doc.scope === 'string' ? { scope: doc.scope } : previous !== undefined && previous.scope !== undefined ? { scope: previous.scope } : {}),
      createdAt: previous !== undefined ? previous.createdAt : now,
      updatedAt: now,
    }
  }

  private fetchJson<T>(url: string): Promise<T> {
    return fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`oauth-flow: GET ${url} was refused (${String(response.status)} ${response.statusText})`)
      return (await response.json()) as T
    })
  }

  private requireConnectors(): Connectors {
    const service = this.ctx.get('connectors')
    /* v8 ignore next -- a deployment composing the engine without the
       connectors service cannot begin a flow; the guard answers a torn-down host */
    if (service === undefined) throw new Error('oauth-flow: the deployment composes no connectors service')
    return service
  }
}

export default OAuthFlowEngine
