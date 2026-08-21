/**
 * mcp domain contract: the roster of MCP servers reporting into the host,
 * plus the user-management calls behind it.
 *
 * `list` is ordinary: it carries server names, connection states, and tool
 * names — no URLs, headers, or credentials — and the MCP surface in the
 * browser needs it to show what is connected. The management calls are
 * privileged and loopback-pinned: `add` writes a server definition (which may
 * carry env or header secrets) and starts an external process or endpoint,
 * `remove` tears one down, and `reconnect` drives a live connection.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Connection lifecycle state of one reported MCP server. */
export type McpServerStatus = 'connecting' | 'connected' | 'reconnecting' | 'down'

/** One MCP tool a server currently registers, by public name. */
export interface McpToolRow {
  /** The model-facing public name (`mcp__<serverName>__<rawName>` or its normalized form). */
  readonly name: string
  /** The server-provided tool description. */
  readonly description: string
}

/** One reported MCP server in `mcp.list`. */
export interface McpServerRow {
  /** Stable local server namespace the server was configured with. */
  readonly serverName: string
  /** Lifecycle state of the server's connection. */
  readonly status: McpServerStatus
  /**
   * Whether the server is user-managed (persisted under the harness home by
   * `mcp.add`): only such a row can be removed through `mcp.remove`. Servers
   * declared in the profile composition are listed and reconnectable but not
   * removable — the deployment, not the user, owns them.
   */
  readonly managed: boolean
  /** The server's tools currently registered, by public name. */
  readonly tools: readonly McpToolRow[]
}

/** One user MCP server over a spawned child process (stdio transport). */
export interface McpStdioServerSpec {
  /**
   * Stable local server namespace for the server's model-facing tool names
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
  /** Extra env vars merged on top of a scrubbed ambient env; defaults to none. */
  readonly env?: Record<string, string>
  /** Working directory for the child process; defaults to the process default. */
  readonly cwd?: string
  /** Per-tool-call timeout in milliseconds; defaults to the host default. */
  readonly toolCallTimeoutMs?: number
}

/** One user MCP server over Streamable HTTP (SSE). */
export interface McpStreamableHttpServerSpec {
  /**
   * Stable local server namespace for the server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`); `[A-Za-z0-9_-]{1,32}`, unique across
   * every live MCP server.
   */
  readonly serverName: string
  /** Selects the Streamable HTTP transport. */
  readonly transport: 'streamable-http'
  /** MCP endpoint URL. */
  readonly url: string
  /** Additional headers attached to MCP requests; defaults to none. */
  readonly headers?: Record<string, string>
  /** Per-tool-call timeout in milliseconds; defaults to the host default. */
  readonly toolCallTimeoutMs?: number
}

/** One user MCP server as added through `mcp.add`. */
export type McpServerSpec = McpStdioServerSpec | McpStreamableHttpServerSpec

/** mcp-domain unary methods (the map key mcp.* of RpcMethodMap). */
export interface McpApi {
  /**
   * Lists every MCP server currently reporting into the host — profile-declared
   * and user-managed alike — sorted by serverName. An empty list means no MCP
   * server is configured in this deployment. The rows are secret-free: no URL,
   * header, env, or command crosses the wire.
   */
  list(request: RpcRequest<{}>):
  Promise<RpcResponse<{ servers: readonly McpServerRow[] }>>

  /**
   * Add one user MCP server: persist its definition under the harness home and
   * mount it live. A server that cannot connect on add is still added — it
   * enters its own reconnect loop and shows up in `list` while recovering.
   *
   * Refused with `mcp-server-exists` when the serverName is already taken by
   * any live server (profile or user), and with `internal` when the mount
   * fails (the manager rolls the persisted file back in that case). A refused
   * add leaves no trace.
   */
  add(request: RpcRequest<{ spec: McpServerSpec }>):
  Promise<RpcResponse<{ serverName: string }>>

  /**
   * Remove one user MCP server: unmount it and delete its persisted definition.
   * Refused with `mcp-server-not-managed` when the server is not user-managed —
   * a profile-declared server is the deployment's, not the user's.
   */
  remove(request: RpcRequest<{ serverName: string }>):
  Promise<RpcResponse<{}>>

  /**
   * Ask one reported server to start a manual reconnect — profile-declared and
   * user-managed alike. Resolves once the reconnect attempt has settled; the
   * server's new state is observable through `list`. Refused with
   * `mcp-server-not-found` when no server currently reports that name.
   */
  reconnect(request: RpcRequest<{ serverName: string }>):
  Promise<RpcResponse<{}>>
}
