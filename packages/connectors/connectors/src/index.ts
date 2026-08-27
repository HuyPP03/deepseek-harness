/**
 * Connector catalog and state machine: the predefined software connectors
 * (Notion, GitHub, Atlassian, Slack, Google Workspace, Microsoft 365, plus
 * user-authored customs) as one orchestration layer over the seams that
 * already own their pieces.
 *
 * A connector is a manifest — its MCP servers, its auth methods, its preset
 * and working area — mounted on demand: connecting resolves the manifest's
 * `{$cred}`/`{$override}` slots through the credentials seam and the
 * connector's override document, then hands plain server specs to
 * `mcp-manager`, whose persisted documents never carry the secrets. Secrets
 * live in exactly one place (the credentials store, or `oauth-tokens` for
 * OAuth grants); disconnecting removes them all.
 *
 * State is derived at read time from the three authorities — the credentials
 * and token stores, the user overrides, and the `mcp-registry` snapshot — so
 * a read never observes a state an operation already superseded.
 *
 * The service is a host-plane orchestrator: it registers no tools and no
 * routes. A deployment without user MCP servers or a credentials provider
 * composes it fine; the operations that need the missing seam refuse with a
 * named error instead of degrading silently.
 *
 * @module @deepseek-ai/dsh-connectors
 */

import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { ServerValue as McpServerValue } from '@deepseek-ai/dsh-mcp-client'
import { UnknownPresetError } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-credentials-oauth-tokens'
import { McpServerExistsError, type McpServerSpec, type StdioServerSpec, type StreamableHttpServerSpec } from '@deepseek-ai/dsh-mcp-manager'
import { parseConnectorManifest, CUSTOM_CONNECTOR_ID } from './manifest.ts'
import type {
  AddCustomSpec,
  ConnectorAuthFlow,
  ConnectorConfigureFields,
  ConnectorDeviceFlow,
  DeviceFlowStart,
  ConnectorAuthMethod,
  TokenAuthMethod,
  ConnectorAuthView,
  ConnectorManifest,
  ConnectorServerSpec,
  ConnectorServerView,
  ConnectorState,
  ConnectorView,
  ServerValue,
} from './types.ts'
export type * from './types.ts'
export {
  CONNECTOR_ID,
  CUSTOM_CONNECTOR_ID,
  InvalidManifestError,
  parseConnectorManifest,
  validateManifest,
} from './manifest.ts'
export type {
  ConnectorAuthMethod,
  ConnectorManifest,
  ConnectorServerSpec,
  ServerValue,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The connector catalog and state machine. */
    connectors: Connectors
    /** The connector OAuth flow engine, where the deployment composes one. */
    oauthFlow?: ConnectorAuthFlow
    /** The connector device-code flow engine, where the deployment composes one. */
    deviceFlow?: ConnectorDeviceFlow
  }
}

/** Connectors config; the Loader validates before the constructor runs. */
export interface Config {
  /** Directory holding one YAML manifest per shipped connector; no default — an unset catalog is empty. */
  readonly catalogDir?: string
  /** Directory holding user override documents and custom connector manifests; defaults to `.connectors` under the harness home. */
  readonly userDir?: string
  /** Harness home used when `userDir` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  readonly dshHome?: string
}

/** One user override document: the non-secret, user-specific fields a connector can be configured with. */
interface ConnectorOverrides {
  /** Provider base URL (self-hosted or multi-tenant endpoint), where the manifest takes one. */
  url?: string
  /** Pre-registered OAuth client id (bring-your-own-app flows). */
  clientId?: string
  /** The provider products the user switched on, where the manifest lists them. */
  products?: string[]
  /** Microsoft 365: enable the organization (Teams/SharePoint) tool set. */
  orgMode?: boolean
  /** GitHub: mount the server read-only. */
  readOnly?: boolean
}

/**
 * The credential reference a byo-app client secret is stored under, derived
 * from the connector id.
 * @param id - the connector id.
 * @returns the derived credential reference name.
 */
export function clientSecretRef(id: string): string {
  return `${id.replace(/-/g, '_').toUpperCase()}_OAUTH_CLIENT_SECRET`
}

/**
 * The credential reference a custom connector's token is stored under,
 * derived from its slug.
 * @param slug - the custom connector's slug (id minus the `custom-` prefix).
 * @returns the derived credential reference name.
 */
export function customTokenRef(slug: string): string {
  return `DSH_CONNECTOR_${slug.replace(/-/g, '_').toUpperCase()}_TOKEN`
}

/** Thrown when an operation targets a connector that is not in the catalog. */
export class ConnectorNotFoundError extends Error {
  constructor(
    /** The missing connector id. */
    readonly connectorId: string,
  ) {
    super(`connectors: no connector "${connectorId}" in the catalog`)
    this.name = 'ConnectorNotFoundError'
  }
}

/** Thrown when a custom connector would claim an id that is already taken. */
export class ConnectorExistsError extends Error {
  constructor(
    /** The id that is already taken. */
    readonly connectorId: string,
  ) {
    super(`connectors: a connector "${connectorId}" already exists`)
    this.name = 'ConnectorExistsError'
  }
}

/** Thrown when a custom-only operation targets a shipped connector. */
export class ConnectorNotCustomError extends Error {
  constructor(
    /** The shipped connector id. */
    readonly connectorId: string,
  ) {
    super(`connectors: connector "${connectorId}" ships with the deployment and cannot be customized or removed`)
    this.name = 'ConnectorNotCustomError'
  }
}

/** Thrown when a `{$cred}` slot resolves to nothing: the credential is not stored. */
export class ConnectorCredentialMissingError extends Error {
  constructor(
    /** The connector id. */
    readonly connectorId: string,
    /** The credential reference that resolved to nothing. */
    readonly ref: string,
  ) {
    super(`connectors: connector "${connectorId}" needs the credential "${ref}" before it can connect; store it first`)
    this.name = 'ConnectorCredentialMissingError'
  }
}

/** Thrown when an override slot resolves to nothing: the field was never configured. */
export class ConnectorOverrideMissingError extends Error {
  constructor(
    /** The connector id. */
    readonly connectorId: string,
    /** The override field that is absent. */
    readonly field: string,
  ) {
    super(`connectors: connector "${connectorId}" needs its "${field}" field configured before it can connect`)
    this.name = 'ConnectorOverrideMissingError'
  }
}

/** Thrown when an auth mode is declared by the manifest but the flow engine is not available in this deployment. */
export class ConnectorAuthUnavailableError extends Error {
  constructor(
    /** The connector id. */
    readonly connectorId: string,
    /** The unavailable auth mode. */
    readonly mode: 'oauth' | 'device',
  ) {
    super(`connectors: the ${mode} auth flow for "${connectorId}" is not available in this deployment yet`)
    this.name = 'ConnectorAuthUnavailableError'
  }
}

/** A mutable mirror of a readonly view type, for construction sites. */
/** Thrown when an oauth connect is attempted before the browser flow stored a token bundle. */
export class ConnectorAuthPendingError extends Error {
  constructor(
    /** The connector id. */
    readonly connectorId: string,
  ) {
    super(`connectors: connector "${connectorId}" has no stored token; authorize it through the browser flow first`)
    this.name = 'ConnectorAuthPendingError'
  }
}

type Writable<T> = { -readonly [K in keyof T]: T[K] }

/** Thrown when an operation needs a seam this deployment does not compose. */
export class ConnectorSeamUnavailableError extends Error {
  constructor(
    /** The missing seam, for the diagnostic. */
    readonly seam: 'credentials' | 'agent-presets',
    /** The operation that needs it. */
    readonly operation: string,
  ) {
    super(`connectors: ${operation} needs the ${seam} seam, which this deployment does not compose`)
    this.name = 'ConnectorSeamUnavailableError'
  }
}

/**
 * Resolve the raw config: an explicit `userDir` is expanded and made
 * absolute; omission falls back to the harness home's `.connectors`
 * directory. The catalog has no default — a deployment that composes no
 * catalog simply lists custom connectors only.
 * @param config - raw plugin config; a programmatic caller may bypass the schema.
 * @returns the resolved directories.
 */
export function resolveConfig(config: Config = {}): { readonly catalogDir: string | undefined; readonly userDir: string } {
  return {
    catalogDir: config.catalogDir !== undefined ? resolve(expandHomePath(config.catalogDir)) : undefined,
    userDir: config.userDir !== undefined ? resolve(expandHomePath(config.userDir)) : dshHomePath('.connectors'),
  }
}

/** The one extension custom connector documents use; anything else is an override document. */
const MANIFEST_FILE_SUFFIX = '.json'

/**
 * The catalog, the user's overrides, and the operations over both.
 */
export class Connectors extends Service {
  static inject = ['mcpManager']
  static Config: z<Config> = z.object({
    catalogDir: z.string(),
    userDir: z.string(),
    dshHome: z.string(),
  })

  private readonly catalogDir: string | undefined
  private readonly userDir: string
  /** Shipped manifests, keyed by id; immutable for the process lifetime. */
  private readonly catalog = new Map<string, ConnectorManifest>()
  /** User-authored manifests, keyed by id; mutated by addCustom/removeCustom. */
  private readonly customs = new Map<string, ConnectorManifest>()
  /** User override documents, keyed by connector id; mutated by configure/disconnect. */
  private readonly overrides = new Map<string, ConnectorOverrides>()
  /** Last operation failure per connector id; cleared by the next success. */
  private readonly lastError = new Map<string, string>()
  /** Last emitted state per connector id; transitions are the events. */
  private readonly lastState = new Map<string, ConnectorState>()
  /** Connectors whose auth flow is in flight (set by the P3 flow engine). */
  private readonly authorizing = new Set<string>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'connectors')
    const spec = resolveConfig(config)
    this.catalogDir = spec.catalogDir
    this.userDir = spec.userDir
  }

  protected async [Service.init](): Promise<void> {
    for (const manifest of await this.loadCatalog()) this.catalog.set(manifest.id, manifest)
    for (const manifest of await this.loadCustoms()) this.customs.set(manifest.id, manifest)
    for (const [id, overrides] of await this.loadOverrides()) this.overrides.set(id, overrides)
  }

  /**
   * Every catalog and custom connector as a wire-safe view, sorted by id.
   * @returns the connector views.
   */
  async list(): Promise<readonly ConnectorView[]> {
    const all = [...this.catalog.values(), ...this.customs.values()].sort((a, b) => a.id.localeCompare(b.id))
    return Promise.all(all.map(manifest => this.view(manifest)))
  }

  /**
   * One connector's wire-safe view.
   * @param id - the connector id.
   * @returns the view, or `undefined` while the id is not in the catalog.
   */
  async get(id: string): Promise<ConnectorView | undefined> {
    const manifest = this.find(id)
    return manifest === undefined ? undefined : this.view(manifest)
  }

  /**
   * The raw manifest of one connector, for host-internal consumers; the wire
   * surface is the view, which carries no server commands or URLs.
   * @param id - the connector id.
   * @returns the manifest, or `undefined` while the id is not in the catalog.
   */
  manifest(id: string): ConnectorManifest | undefined {
    return this.find(id)
  }

  /**
   * Mark one connector's auth flow in flight or settled. The flow engine is
   * the only writer: while flagged, the derived state is `authorizing`
   * regardless of the seams underneath.
   * @param id - the connector id.
   * @param inFlight - whether a flow is in flight.
   */
  setAuthorizing(id: string, inFlight: boolean): void {
    if (inFlight) this.authorizing.add(id)
    else this.authorizing.delete(id)
  }

  /**
   * The byoApp client id the user configured through `configure`, while
   * configured; the flow engine reads it at registration.
   * @param id - the connector id.
   * @returns the configured client id, or `undefined` while unconfigured.
   */
  overrideClientId(id: string): string | undefined {
    return this.overrides.get(id)?.clientId
  }

  /**
   * Record an auth-flow failure for one connector and republish its state:
   * the failure surfaces as the connector's `error` state with the message
   * as `lastError`, until the next successful operation clears it.
   * @param id - the connector id.
   * @param message - the failure to surface.
   */
  async recordFlowFailure(id: string, message: string): Promise<void> {
    const manifest = this.find(id)
    if (manifest === undefined) return
    this.lastError.set(id, message)
    // The failure is published once, as a one-shot view: the transition log
    // is reset so a later settle to the same label republishes, and the
    // stored label is dropped so the next derived state starts clean. The
    // message stays in the in-memory view until the next settled operation
    // (configure, connect, disconnect) clears lastError.
    this.lastState.delete(id)
    this.publish(manifest, await this.view(manifest))
  }

  /**
   * Settle an auth flow that completed without a stored credential (a
   * device login): clear the authorizing flag, drop any recorded failure,
   * and republish the connector's view.
   * @param id - the connector the flow settled for.
   */
  async settleAuthFlow(id: string): Promise<void> {
    const manifest = this.find(id)
    if (manifest === undefined) return
    this.setAuthorizing(id, false)
    this.lastError.delete(id)
    this.publish(manifest, await this.view(manifest))
  }

  /**
   * Configure one connector: store the provided credential values through
   * the credentials seam, persist the non-secret fields in its override
   * document, and — for a token method that is fully configured for the
   * first time — mount its servers.
   *
   * @param id - the connector id.
   * @param fields - the fields to set; absent fields are left untouched.
   */
  async configure(id: string, fields: ConnectorConfigureFields): Promise<void> {
    const manifest = this.require(id)
    const tokenMethod = manifest.auth.find(method => method.mode === 'token')

    if (fields.token !== undefined || fields.credentials !== undefined) {
      if (tokenMethod === undefined) {
        throw new Error(`connectors: connector "${id}" supports no token auth`)
      }
      const credentials = this.credentialsOrThrow('configure')
      const byRef: Record<string, string> = { ...fields.credentials }
      if (fields.token !== undefined) {
        const firstRef = tokenMethod.credentialRefs[0]
        /* v8 ignore next -- the manifest validator requires a token method's credentialRefs to be non-empty */
        if (firstRef === undefined) {
          throw new Error(`connectors: connector "${id}" has a token method without a credential reference`)
        }
        byRef[firstRef] = fields.token
      }
      for (const [ref, value] of Object.entries(byRef)) {
        if (!tokenMethod.credentialRefs.includes(ref)) {
          throw new Error(`connectors: "${ref}" is not a credential reference of connector "${id}"`)
        }
        await credentials.set(credentialRef(ref), value)
      }
    }

    if (fields.url !== undefined || fields.clientId !== undefined || fields.products !== undefined
      || fields.orgMode !== undefined || fields.readOnly !== undefined) {
      const next: ConnectorOverrides = { ...(this.overrides.get(id) ?? {}) }
      if (fields.url !== undefined) next.url = fields.url
      if (fields.clientId !== undefined) next.clientId = fields.clientId
      if (fields.products !== undefined) next.products = [...fields.products]
      if (fields.orgMode !== undefined) next.orgMode = fields.orgMode
      if (fields.readOnly !== undefined) next.readOnly = fields.readOnly
      await this.writeOverride(id, next)
    }

    if (fields.clientSecret !== undefined) {
      if (!manifest.auth.some(method => method.mode === 'oauth' && method.byoApp)) {
        throw new Error(`connectors: connector "${id}" supports no bring-your-own-app OAuth, so it has no client secret`)
      }
      const credentials = this.credentialsOrThrow('configure')
      await credentials.set(credentialRef(clientSecretRef(id)), fields.clientSecret)
    }

    if (fields.token !== undefined || fields.credentials !== undefined) {
      if (await this.tokenMethodConfigured(manifest)) {
        try {
          await this.mountServers(manifest)
          this.lastError.delete(id)
        } catch (error) {
          // The credential is stored; the mount failed. Surface the failure
          // as the connector's state rather than losing the stored value.
          /* v8 ignore next -- mcp-manager rejects with Error instances; the String(error) peer answers the catch type */
          this.lastError.set(id, error instanceof Error ? error.message : String(error))
        }
      }
    }
    this.publish(manifest, await this.view(manifest))
  }

  /**
   * Connect one connector: mount its servers with every slot resolved.
   * `token` mode resolves now; `oauth` mode mounts through the stored token
   * bundle (refreshing it through the flow engine when one is composed);
   * `device` mode mounts first, then hands the mount to the device-code flow
   * engine, which drives the provider's login tool and settles the state in
   * the background.
   *
   * @param id - the connector id.
   * @param mode - the auth mode to connect through.
   * @throws {@link ConnectorAuthPendingError} when an oauth connector has no stored bundle yet.
   * @returns the device flow's start facts for a `device` connect; `undefined` otherwise.
   */
  async connect(id: string, mode: 'token' | 'oauth' | 'device'): Promise<DeviceFlowStart | undefined> {
    const manifest = this.require(id)
    const method = manifest.auth.find(entry => entry.mode === mode)
    if (method === undefined) {
      throw new Error(`connectors: connector "${id}" supports no ${mode} auth`)
    }
    if (mode === 'device') {
      const flow = this.ctx.get('deviceFlow')
      if (flow === undefined) throw new ConnectorAuthUnavailableError(id, 'device')
      await this.mountServers(manifest)
      try {
        const started = await flow.begin(id)
        this.lastError.delete(id)
        this.publish(manifest, await this.view(manifest))
        return started
      } catch (error) {
        // The login tool refused or the server went down mid-flow: roll the
        // mount back so a failed connect leaves no partial trace, and
        // surface the failure as the connector's error state.
        await this.unmountServers(manifest)
        await this.recordFlowFailure(id, error instanceof Error ? error.message : String(error))
        throw error
      }
    }
    if (mode === 'oauth') {
      // The browser flow (connector.authorize) stores the bundle first; a
      // stored one may be refreshable before the mount presents it.
      if (this.ctx.get('oauthFlow') === undefined) throw new ConnectorAuthUnavailableError(id, 'oauth')
      const bundle = this.ctx.get('oauthTokens')?.get(id)
      if (bundle === undefined) throw new ConnectorAuthPendingError(id)
      const flow = this.ctx.get('oauthFlow')
      if (flow !== undefined) await flow.ensureFresh(id)
      await this.mountServers(manifest)
      this.lastError.delete(id)
      this.publish(manifest, await this.view(manifest))
      return
    }
    await this.requireTokenRefsStored(id, method as TokenAuthMethod)
    await this.mountServers(manifest)
    this.lastError.delete(id)
    this.publish(manifest, await this.view(manifest))
  }

  /**
   * Disconnect one connector: unmount its servers, remove its stored
   * credentials and token bundle, and delete its override document.
   * @param id - the connector id.
   */
  async disconnect(id: string): Promise<void> {
    const manifest = this.require(id)
    await this.teardownServersAndToken(manifest)
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined && manifest.auth.some(method => method.mode === 'oauth')) {
      await credentials.unset(credentialRef(clientSecretRef(id)))
    }
    const tokens = this.ctx.get('oauthTokens')
    if (tokens !== undefined) await tokens.remove(id)
    if (this.overrides.has(id)) await this.writeOverride(id, {})
    this.lastError.delete(id)
    this.publish(manifest, await this.view(manifest))
  }

  /**
   * Author one custom connector: persist its manifest under the user
   * directory and copy the shipped `custom` preset to it. A failed preset
   copy leaves no manifest file; a failed manifest write removes the preset
   copy.
   *
   * @param spec - the custom connector definition.
   * @returns the new connector id.
   */
  async addCustom(spec: AddCustomSpec): Promise<string> {
    const slug = spec.id ?? slugify(spec.name)
    if (!/^[a-z0-9][a-z0-9-]{0,24}$/.test(slug)) {
      throw new Error(`connectors: the name "${spec.name}" does not yield a valid connector id (expected 1–25 lower-case letters, digits, or dashes, starting alphanumeric)`)
    }
    if (spec.transport === 'stdio') {
      if (spec.command === undefined || spec.command.length === 0) throw new Error('connectors: a stdio custom connector needs a command')
      if (spec.headers !== undefined) throw new Error('connectors: headers belong to a streamable-http custom connector, not a stdio one')
    } else {
      if (spec.url === undefined || spec.url.length === 0) throw new Error('connectors: a streamable-http custom connector needs a url')
      if (spec.env !== undefined) throw new Error('connectors: env vars belong to a stdio custom connector, not a streamable-http one')
    }
    if (spec.tokenVarIsHeader && spec.transport !== 'streamable-http') {
      throw new Error('connectors: a header token var needs a streamable-http connector')
    }
    const id = `custom-${slug}`
    if (this.catalog.has(id) || this.customs.has(id)) throw new ConnectorExistsError(id)

    const manifest = buildCustomManifest(id, slug, spec)
    const agentPresets = this.ctx.get('agentPresets')
    if (agentPresets === undefined) throw new ConnectorSeamUnavailableError('agent-presets', 'adding a custom connector')
    await agentPresets.copy('custom', id, spec.name)
    try {
      await this.writeCustomManifest(id, manifest)
    } catch (error) {
      /* v8 ignore next -- the preset root must fail between the copy and this rollback remove; the rethrow itself is tested */
      await agentPresets.remove(id).catch(() => undefined)
      throw error
    }
    this.customs.set(id, manifest)
    // A custom server that authenticates needs no flow at all: mount it now,
    // and a failed mount shows as the connector's error state.
    if (manifest.auth.length === 0) {
      try {
        await this.mountServers(manifest)
      } catch (error) {
        /* v8 ignore next -- mcp-manager rejects with Error instances; the String(error) peer answers the catch type */
        this.lastError.set(id, error instanceof Error ? error.message : String(error))
      }
    }
    this.publish(manifest, await this.view(manifest))
    return id
  }

  /**
   * Remove one custom connector: remove its preset copy, its manifest, its
   * servers, and its stored credentials. Shipped connectors refuse.
   * @param id - the custom connector id.
   */
  async removeCustom(id: string): Promise<void> {
    const manifest = this.customs.get(id)
    if (manifest === undefined) {
      if (this.catalog.has(id)) throw new ConnectorNotCustomError(id)
      throw new ConnectorNotFoundError(id)
    }
    const agentPresets = this.ctx.get('agentPresets')
    if (agentPresets !== undefined) {
      // The preset copy may already be gone (a hand deletion); the connector
      // is still removable, so that one absence is the swallowed case.
      await agentPresets.remove(id).catch((error: unknown) => {
        if (!(error instanceof UnknownPresetError)) throw error
      })
    }
    await this.teardownServersAndToken(manifest)
    await this.removeCustomManifest(id)
    this.customs.delete(id)
    this.overrides.delete(id)
    this.lastError.delete(id)
    this.lastState.delete(id)
  }

  /* jscpd:ignore-start -- the contained-dispatch fan-out is the same reviewed
     contract as the credentials and oauth-tokens stores. */

  /**
   * Derive one manifest's current state and view.
   * @param manifest - the manifest to derive from.
   * @returns the wire-safe view.
   */
  private async view(manifest: ConnectorManifest): Promise<ConnectorView> {
    const overrides = this.overrides.get(manifest.id) ?? {}
    const registry = this.ctx.mcpManager.servers()
    const servers: ConnectorServerView[] = manifest.servers.map((server) => {
      const entry = registry.find(candidate => candidate.serverName === server.serverName)
      const view: Writable<ConnectorServerView> = { serverName: server.serverName, mounted: entry !== undefined }
      if (entry !== undefined) {
        view.status = entry.status
        view.tools = entry.tools.map(tool => tool.name)
      }
      return view
    })
    const auth: ConnectorAuthView[] = await Promise.all(manifest.auth.map(async (method) => {
      const view: Writable<ConnectorAuthView> = {
        mode: method.mode,
        configured: await this.methodConfigured(method, manifest.id, overrides),
      }
      if (method.mode === 'token') {
        view.credentialRefs = [...method.credentialRefs]
        if (method.howTo !== undefined) view.howTo = method.howTo
      }
      if (method.mode === 'oauth') {
        view.byoApp = method.byoApp === true
        if (method.setupGuide !== undefined) view.setupGuide = [...method.setupGuide]
        if (method.reauthHint !== undefined) view.reauthHint = method.reauthHint
      }
      if (method.mode === 'device' && method.howTo !== undefined) view.howTo = method.howTo
      return view
    }))
    const state = this.stateOf(manifest.id, servers, auth.some(entry => entry.configured))
    const view: Writable<ConnectorView> = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      presetId: manifest.presetId,
      state,
      custom: this.customs.has(manifest.id),
      servers,
      auth,
      suggestions: [...(manifest.suggestions ?? [])],
    }
    const lastError = this.lastError.get(manifest.id)
    if (state === 'error' && lastError !== undefined) view.lastError = lastError
    if (manifest.products !== undefined) view.products = [...manifest.products]
    return view
  }

  /**
   * The derived state for one connector: an in-flight flow wins, then the
   * live registry status of its mounted servers (worst first), then whether
   * the connector is configured, then a recorded operation failure.
   */
  private stateOf(id: string, servers: readonly ConnectorServerView[], configured: boolean): ConnectorState {
    if (this.authorizing.has(id)) return 'authorizing'
    const mounted = servers.filter(server => server.mounted)
    if (mounted.length > 0) {
      const statuses = mounted
        .map(server => server.status)
        .filter((status): status is 'connecting' | 'connected' | 'reconnecting' | 'down' => status !== undefined)
      /* v8 ignore next -- reaching down needs the mcp-client retry budget exhausted; mcp-client's reconnect suite pins that path */
      if (statuses.includes('down')) return this.lastError.has(id) ? 'error' : 'down'
      if (statuses.includes('reconnecting')) return 'reconnecting'
      if (statuses.includes('connecting')) return 'connecting'
      // A successful mount deletes lastError, so a live registry view plus a
      // pending failure means the connector does not own the reported name
      // (its mount was refused, e.g. the name is taken by a profile server).
      if (this.lastError.has(id)) return 'error'
      return 'connected'
    }
    if (this.lastError.has(id)) return 'error'
    return configured ? 'needs-auth' : 'unconfigured'
  }

  /**
   * Fan `connector/state` out, but only on a transition: the last emitted
   * state is the baseline, so a read-heavy surface polling `list` never
   * re-fires an unchanged state. The caller passes the view it just derived,
   * so the event follows the operation's commit with no second read.
   * @param manifest - the connector the operation settled on.
   * @param view - the view the operation derived.
   */
  private publish(manifest: ConnectorManifest, view: ConnectorView): void {
    const previous = this.lastState.get(manifest.id)
    if (previous === view.state) return
    this.lastState.set(manifest.id, view.state)
    let invariantFailure: unknown
    const args = ['connector/state', manifest.id, view.state]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(...listenerArgs: unknown[]) => unknown>) {
      try {
        const returned = listener(manifest.id, view.state)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.ctx.logger.warn('connectors: a connector/state listener for "%s" failed', manifest.id)
            this.ctx.logger.warn(error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.ctx.logger.warn('connectors: a connector/state listener for "%s" failed', manifest.id)
        this.ctx.logger.warn(error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }

  /* jscpd:ignore-end */

  /** Whether one auth method currently has everything it needs. */
  private async methodConfigured(method: ConnectorAuthMethod, id: string, overrides: ConnectorOverrides): Promise<boolean> {
    if (method.mode === 'token') return this.tokenMethodRefsConfigured(method.credentialRefs)
    const tokens = this.ctx.get('oauthTokens')
    if (tokens !== undefined && tokens.get(id) !== undefined) return true
    if (method.mode === 'oauth' && method.byoApp) {
      // The client id alone starts the flow: the secret is optional (public
      // desktop clients, e.g. Google's, keep none) and the flow presents it
      // only when one is stored.
      return overrides.clientId !== undefined
    }
    return false
  }

  /** Whether a token method's references are all stored. */
  private async tokenMethodRefsConfigured(refs: readonly string[]): Promise<boolean> {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return false
    const resolved = await Promise.all(refs.map(ref => credentials.resolve(credentialRef(ref))))
    return resolved.every(value => value !== undefined)
  }

  private async tokenMethodConfigured(manifest: ConnectorManifest): Promise<boolean> {
    const method = manifest.auth.find(entry => entry.mode === 'token')
    return method !== undefined && this.tokenMethodRefsConfigured(method.credentialRefs)
  }

  /**
   * Mount every server the manifest declares that is not mounted yet,
   * resolving each slot through the seams. A mid-way failure unmounts the
   * servers this call added, so a failed connect leaves no partial trace.
   */
  private async mountServers(manifest: ConnectorManifest): Promise<void> {
    const added: string[] = []
    for (const server of manifest.servers) {
      if (this.ctx.mcpManager.userServers().includes(server.serverName)) continue
      try {
        await this.ctx.mcpManager.add(this.toManagerSpec(manifest, server))
        added.push(server.serverName)
      } catch (error) {
        for (const name of added) await this.ctx.mcpManager.remove(name)
        if (error instanceof McpServerExistsError) {
          throw new Error(`connectors: server name "${server.serverName}" of connector "${manifest.id}" is already taken by another MCP server`, { cause: error })
        }
        throw error
      }
    }
  }

  /**
   * Unmount every server the manifest declares, for a rolled-back connect.
   * @param manifest - the manifest whose servers to remove.
   */
  private async unmountServers(manifest: ConnectorManifest): Promise<void> {
    for (const server of manifest.servers) {
      if (this.ctx.mcpManager.userServers().includes(server.serverName)) {
        await this.ctx.mcpManager.remove(server.serverName)
      }
    }
  }

  /**
   * Convert one manifest server spec into the mcp-manager spec, resolving
   * every placeholder to its literal value. P0a resolves inline through the
   * credentials seam; the persisted server document carries the literal,
   * never the reference.
   */
  private toManagerSpec(manifest: ConnectorManifest, server: ConnectorServerSpec): McpServerSpec {
    if (server.transport === 'stdio') {
      const env: Record<string, McpServerValue> = {}
      for (const [key, slot] of Object.entries(server.env ?? {})) {
        env[key] = this.resolveSlot(manifest, slot)
      }
      const spec: Writable<StdioServerSpec> = {
        serverName: server.serverName,
        transport: 'stdio',
        command: server.command,
        args: [...(server.args ?? [])],
        env,
      }
      if (server.cwd !== undefined) spec.cwd = server.cwd
      if (server.toolCallTimeoutMs !== undefined) spec.toolCallTimeoutMs = server.toolCallTimeoutMs
      return spec
    }
    const headers: Record<string, McpServerValue> = {}
    for (const [key, slot] of Object.entries(server.headers ?? {})) {
      headers[key] = this.resolveSlot(manifest, slot)
    }
    const spec: Writable<StreamableHttpServerSpec> = {
      serverName: server.serverName,
      transport: 'streamable-http',
      url: server.url,
      headers,
    }
    if (server.toolCallTimeoutMs !== undefined) spec.toolCallTimeoutMs = server.toolCallTimeoutMs
    return spec
  }

  /**
   * Pass a `{$cred}` reference through — after verifying that a token method's
   * slot only references one of its declared refs — and resolve an `$override`
   * slot to its literal. An oauth-method reference is an owner id for the
   * token store and passes through unchecked.
   */
  private resolveSlot(manifest: ConnectorManifest, slot: ServerValue): McpServerValue {
    if (typeof slot === 'string') return slot
    if ('$cred' in slot) {
      const method = manifest.auth.find(entry => entry.mode === 'token')
      if (method !== undefined && !method.credentialRefs.includes(slot.$cred)) {
        throw new ConnectorCredentialMissingError(manifest.id, slot.$cred)
      }
      return { $cred: slot.$cred }
    }
    const overrides = this.overrides.get(manifest.id) ?? {}
    const value = (overrides as Record<string, unknown>)[slot.$override]
    if (typeof value !== 'string' || value.length === 0) throw new ConnectorOverrideMissingError(manifest.id, slot.$override)
    return value
  }

  /**
   * Fail a token connect early when a reference is unconfigured: the server
   * document carries the reference through to mcp-client, where a missing
   * value would surface as a connection failure rather than this product
   * error.
   */
  private async requireTokenRefsStored(id: string, method: TokenAuthMethod): Promise<void> {
    const credentials = this.ctx.get('credentials')
    for (const ref of method.credentialRefs) {
      const resolved = credentials !== undefined ? await credentials.resolve(credentialRef(ref)) : undefined
      if (resolved === undefined) throw new ConnectorCredentialMissingError(id, ref)
    }
  }

  private credentialsOrThrow(operation: string): CredentialProvider {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw new ConnectorSeamUnavailableError('credentials', operation)
    return credentials
  }

  /** One connector's document path inside the user directory. */
  private filePath(id: string): string {
    return join(this.userDir, `${id}${MANIFEST_FILE_SUFFIX}`)
  }

  /** Parse one override document strictly; unknown fields are rejected. */
  private parseOverrideDocument(text: string, id: string): ConnectorOverrides {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error) {
      /* v8 ignore next -- JSON.parse only throws SyntaxError, an Error; the String(error) peer answers the catch type */
      throw new Error(`connectors: override document for "${id}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`connectors: override document for "${id}" must be a JSON object`)
    }
    const record = raw as Record<string, unknown>
    const out: ConnectorOverrides = {}
    for (const field of ['url', 'clientId'] as const) {
      if (record[field] !== undefined) {
        if (typeof record[field] !== 'string') throw new Error(`connectors: override field "${field}" of "${id}" must be a string`)
        out[field] = record[field]
      }
    }
    if (record.products !== undefined) {
      if (!Array.isArray(record.products) || record.products.some(entry => typeof entry !== 'string')) {
        throw new Error(`connectors: override field "products" of "${id}" must be an array of strings`)
      }
      out.products = [...(record.products as string[])]
    }
    for (const field of ['orgMode', 'readOnly'] as const) {
      if (record[field] !== undefined) {
        if (typeof record[field] !== 'boolean') throw new Error(`connectors: override field "${field}" of "${id}" must be a boolean`)
        out[field] = record[field]
      }
    }
    for (const key of Object.keys(record)) {
      if (!['url', 'clientId', 'products', 'orgMode', 'readOnly'].includes(key)) {
        throw new Error(`connectors: override document for "${id}" has an unknown field "${key}"`)
      }
    }
    return out
  }

  /**
   * Unmount the user servers the manifest mounted and unset its stored token
   * credentials; the optional seam is simply skipped when absent.
   * @param manifest - the manifest whose mounted servers carry the connector's state.
   */
  private async teardownServersAndToken(manifest: ConnectorManifest): Promise<void> {
    for (const server of manifest.servers) {
      if (this.ctx.mcpManager.userServers().includes(server.serverName)) {
        await this.ctx.mcpManager.remove(server.serverName)
      }
    }
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return
    for (const method of manifest.auth) {
      if (method.mode === 'token') {
        for (const ref of method.credentialRefs) await credentials.unset(credentialRef(ref))
      }
    }
  }

  /** Read a manifest directory's entries; a missing directory is none. */
  private async readManifestEntries(dir: string): Promise<import('node:fs').Dirent[]> {
    try {
      return await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  /** Load the shipped catalog; a missing directory is an empty catalog. */
  private async loadCatalog(): Promise<ConnectorManifest[]> {
    if (this.catalogDir === undefined) return []
    const manifests: ConnectorManifest[] = []
    for (const entry of (await this.readManifestEntries(this.catalogDir))
      .filter(file => file.isFile() && file.name.endsWith('.yml'))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const text = await readFile(join(this.catalogDir, entry.name), 'utf8')
      manifests.push(parseConnectorManifest(text, join(this.catalogDir, entry.name), 'yaml'))
    }
    return manifests
  }

  /** Load the user-authored customs; a missing directory is none. */
  private async loadCustoms(): Promise<ConnectorManifest[]> {
    const manifests: ConnectorManifest[] = []
    for (const entry of (await this.readManifestEntries(this.userDir))
      .filter(file => file.isFile() && file.name.endsWith(MANIFEST_FILE_SUFFIX))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const id = entry.name.slice(0, -MANIFEST_FILE_SUFFIX.length)
      if (!CUSTOM_CONNECTOR_ID.test(id)) continue
      const text = await readFile(join(this.userDir, entry.name), 'utf8')
      const manifest = parseConnectorManifest(text, join(this.userDir, entry.name), 'json')
      if (manifest.id !== id) throw new Error(`connectors: ${entry.name} declares id "${manifest.id}"`)
      manifests.push(manifest)
    }
    return manifests
  }

  /** Load the user override documents; a missing directory is none. */
  private async loadOverrides(): Promise<Array<[string, ConnectorOverrides]>> {
    const loaded: Array<[string, ConnectorOverrides]> = []
    for (const entry of (await this.readManifestEntries(this.userDir))
      .filter(file => file.isFile() && file.name.endsWith(MANIFEST_FILE_SUFFIX))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const id = entry.name.slice(0, -MANIFEST_FILE_SUFFIX.length)
      if (CUSTOM_CONNECTOR_ID.test(id)) continue
      const text = await readFile(join(this.userDir, entry.name), 'utf8')
      loaded.push([id, this.parseOverrideDocument(text, id)])
    }
    return loaded
  }

  /** Persist one override document (0600 under the owner-only user directory). */
  private async writeOverride(id: string, overrides: ConnectorOverrides): Promise<void> {
    await mkdir(this.userDir, { recursive: true, mode: 0o700 })
    if (Object.keys(overrides).length === 0) {
      this.overrides.delete(id)
      await rm(this.filePath(id), { force: true })
      return
    }
    this.overrides.set(id, overrides)
    await writeFileAtomic(this.filePath(id), JSON.stringify(overrides, null, 2) + '\n', { mode: 0o600 })
  }

  /** Persist one custom connector manifest (0600 under the owner-only user directory). */
  private async writeCustomManifest(id: string, manifest: ConnectorManifest): Promise<void> {
    await mkdir(this.userDir, { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.filePath(id), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
  }

  /** Delete one custom connector manifest. */
  private async removeCustomManifest(id: string): Promise<void> {
    await rm(this.filePath(id), { force: true })
  }

  /** One manifest from the two maps, or undefined. */
  private find(id: string): ConnectorManifest | undefined {
    return this.catalog.get(id) ?? this.customs.get(id)
  }

  /** One manifest from the two maps, or a named error. */
  private require(id: string): ConnectorManifest {
    const manifest = this.find(id)
    if (manifest === undefined) throw new ConnectorNotFoundError(id)
    return manifest
  }
}

/** Derive a lower-case slug from a display name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build the manifest for one custom connector: one server, and a token auth
 * method only when a token var was declared.
 */
function buildCustomManifest(id: string, slug: string, spec: AddCustomSpec): ConnectorManifest {
  const tokenRef = customTokenRef(slug)
  const tokenVar = spec.tokenVar
  const env: Record<string, ServerValue> = { ...spec.env }
  const headers: Record<string, ServerValue> = { ...spec.headers }
  if (tokenVar !== undefined && !spec.tokenVarIsHeader && spec.transport === 'stdio') {
    env[tokenVar] = { $cred: tokenRef }
  }
  if (tokenVar !== undefined && spec.tokenVarIsHeader && spec.transport === 'streamable-http') {
    headers[tokenVar] = { $cred: tokenRef }
  }
  const server: ConnectorServerSpec = spec.transport === 'stdio'
    ? {
      serverName: id,
      transport: 'stdio',
      /* v8 ignore next -- addCustom validates a stdio custom to carry a non-empty command */
      command: spec.command ?? '',
      args: [...(spec.args ?? [])],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    }
    : {
      serverName: id,
      transport: 'streamable-http',
      /* v8 ignore next -- addCustom validates a streamable-http custom to carry a non-empty url */
      url: spec.url ?? '',
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    }
  return {
    id,
    name: spec.name,
    description: 'A user-authored connector.',
    presetId: id,
    workspaceDirName: slug,
    servers: [server],
    auth: tokenVar !== undefined
      ? [{ mode: 'token', credentialRefs: [tokenRef], howTo: `Store the token under ${tokenRef}, or paste it in the Connect dialog.` }]
      : [],
  }
}

export default Connectors
