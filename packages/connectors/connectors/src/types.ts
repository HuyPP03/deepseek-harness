/**
 * Client-safe type surface of the connector catalog and state machine: the
 * manifest shapes, the connector views that cross the wire, and the
 * connector state's Cordis event declaration. Types only — no runtime code,
 * and nothing here reaches a Host-only symbol, so a Client compilation face
 * reads exactly the signature the Host emits.
 *
 * @module @deepseek-ai/dsh-connectors/types
 */

/**
 * A manifest placeholder for a credential value: resolved through the
 * credentials seam at connect time, never stored in the manifest or the
 * mounted server's persisted document.
 */
export interface CredRefPlaceholder {
  /** The credential reference the value resolves to at connect time. */
  readonly $cred: string
}

/**
 * A manifest placeholder for a user-specific, non-secret field supplied
 * through `configure` and persisted in the connector's override document.
 */
export interface OverridePlaceholder {
  /** The override-document field the value resolves to at connect time. */
  readonly $override: string
}

/** A server-spec string slot: a literal or one of the two placeholders. */
export type ServerValue = string | CredRefPlaceholder | OverridePlaceholder

/** One connector MCP server over a spawned child process (stdio transport). */
export interface ConnectorStdioServerSpec {
  /**
   * Stable local server namespace for the model-facing tool names
   * (`mcp__<serverName>__<rawName>`); `[A-Za-z0-9_-]{1,32}`, unique across
   * every live MCP server.
   */
  readonly serverName: string
  /** Selects the child-process stdio transport. */
  readonly transport: 'stdio'
  /** Executable used to start the server. */
  readonly command: string
  /** Arguments passed directly, without shell interpolation; defaults to none. */
  readonly args?: readonly string[]
  /** Extra env vars; a value may carry a {@link CredRefPlaceholder} or {@link OverridePlaceholder}. */
  readonly env?: Record<string, ServerValue>
  /** Working directory for the child process; defaults to the process default. */
  readonly cwd?: string
  /** Per-tool-call timeout in milliseconds; defaults to the mcp-client default. */
  readonly toolCallTimeoutMs?: number
}

/** One connector MCP server over Streamable HTTP (SSE). */
export interface ConnectorStreamableHttpServerSpec {
  /**
   * Stable local server namespace for the model-facing tool names
   * (`mcp__<serverName>__<rawName>`); `[A-Za-z0-9_-]{1,32}`, unique across
   * every live MCP server.
   */
  readonly serverName: string
  /** Selects the Streamable HTTP transport. */
  readonly transport: 'streamable-http'
  /** MCP endpoint URL. */
  readonly url: string
  /** Additional headers; a value may carry a {@link CredRefPlaceholder} or {@link OverridePlaceholder}. */
  readonly headers?: Record<string, ServerValue>
  /** Per-tool-call timeout in milliseconds; defaults to the mcp-client default. */
  readonly toolCallTimeoutMs?: number
}

/** One connector MCP server as declared in a manifest. */
export type ConnectorServerSpec = ConnectorStdioServerSpec | ConnectorStreamableHttpServerSpec

/**
 * Token-paste auth: the user stores one value per credential reference
 * through the credentials seam. Multi-reference methods (a self-hosted
 * server that takes a username and a token) list them all; the connector is
 * configured only when every reference is stored.
 */
export interface TokenAuthMethod {
  /** Selects the token-paste mode. */
  readonly mode: 'token'
  /** The credential references this method consumes. */
  readonly credentialRefs: readonly string[]
  /** User-facing instructions for obtaining the value. */
  readonly howTo?: string
}

/**
 * OAuth auth: a browser (or code-paste) flow completes one authorization
 * grant per connector, stored as a token bundle. `byoApp` marks providers
 * without dynamic client registration, where the user pre-registers an app
 * and supplies the client id (and, where the provider keeps one, the
 * client secret).
 */
export interface OauthAuthMethod {
  /** Selects the OAuth mode. */
  readonly mode: 'oauth'
  /** The provider MCP endpoint the flow authorizes against. */
  readonly serverUrl: string
  /** Whether the user must supply a pre-registered client id first. */
  readonly byoApp?: boolean
  /** One-time setup instructions for the pre-registered app. */
  readonly setupGuide?: readonly string[]
  /** Re-authentication cadence to surface (e.g. Google's 7-day window). */
  readonly reauthHint?: string
}

/**
 * Device-code auth: the provider's server-side flow; the user completes a
 * code in a browser and the connector's own server tools verify it.
 */
export interface DeviceAuthMethod {
  /** Selects the device-code mode. */
  readonly mode: 'device'
  /** User-facing instructions for completing the device flow. */
  readonly howTo?: string
  /** The server-side login tool the flow drives. */
  readonly loginTool?: string
  /** The server-side tool that reports whether the login settled. */
  readonly verifyTool?: string
}

/** One auth method a connector supports; a manifest lists one per mode. */
export type ConnectorAuthMethod = TokenAuthMethod | OauthAuthMethod | DeviceAuthMethod

/** One shipped or custom connector, as parsed and validated from its document. */
export interface ConnectorManifest {
  /** Stable connector id; directory-safe and unique across the catalog. */
  readonly id: string
  /** Display name shown on the card. */
  readonly name: string
  /** One-line description shown on the card. */
  readonly description: string
  /** The agent preset a session with this connector uses. */
  readonly presetId: string
  /** The per-connector working-area directory under the harness home. */
  readonly workspaceDirName: string
  /** The provider products this connector can switch between, where the provider has them. */
  readonly products?: readonly string[]
  /** The MCP servers mounted when the connector connects. */
  readonly servers: readonly ConnectorServerSpec[]
  /** The auth methods the connector supports, one per mode. */
  readonly auth: readonly ConnectorAuthMethod[]
  /** First-run prompt suggestions for a blank connector session. */
  readonly suggestions?: readonly string[]
}

/** Connection lifecycle state of one connector, derived at read time. */
export type ConnectorState =
  | 'unconfigured'
  | 'needs-auth'
  | 'authorizing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'down'
  | 'error'

/** Wire view of one connector MCP server: no command, env, URL, or header crosses. */
export interface ConnectorServerView {
  /** The server's stable namespace. */
  readonly serverName: string
  /** Whether the connector currently mounts this server. */
  readonly mounted: boolean
  /** The live registry status while mounted. */
  readonly status?: 'connecting' | 'connected' | 'reconnecting' | 'down'
}

/** Wire view of one supported auth method: whether it is configured, never its values. */
export interface ConnectorAuthView {
  /** The auth mode. */
  readonly mode: 'token' | 'oauth' | 'device'
  /** Whether this method currently has everything it needs. */
  readonly configured: boolean
  /** The token method's credential reference names, one field per reference; the names are public manifest data. */
  readonly credentialRefs?: readonly string[]
  /** User-facing instructions for obtaining the credential. */
  readonly howTo?: string
  /** Setup instructions for pre-registered-app OAuth methods. */
  readonly setupGuide?: readonly string[]
  /** Re-authentication cadence, where the provider has one. */
  readonly reauthHint?: string
}

/** Wire view of one catalog or custom connector: secret-free by construction. */
export interface ConnectorView {
  /** The connector id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** One-line description. */
  readonly description: string
  /** The agent preset a session with this connector uses. */
  readonly presetId: string
  /** The derived state. */
  readonly state: ConnectorState
  /** The last failed operation's message, while the state is `error`. */
  readonly lastError?: string
  /** Whether the connector was authored by the user rather than shipped. */
  readonly custom: boolean
  /** The declared servers and their live state. */
  readonly servers: readonly ConnectorServerView[]
  /** The supported auth methods and their configured state. */
  readonly auth: readonly ConnectorAuthView[]
  /** First-run prompt suggestions. */
  readonly suggestions: readonly string[]
  /** The switchable provider products, where the provider has them. */
  readonly products?: readonly string[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A connector's derived state changed as the result of a connector
     * operation (configure, connect, disconnect, add, remove) or an auth
     * flow transition. Registry status flips that happen without a connector
     * operation are not emitted; surfaces poll `list` for those. Listener
     * failures are contained and logged, except `INVARIANT`-coded failures,
     * which rethrow after every listener ran.
     * @param connectorId - the connector whose state changed.
     * @param state - the new derived state.
     * @mode emit
     */
    'connector/state'(connectorId: string, state: ConnectorState): void
  }
}
