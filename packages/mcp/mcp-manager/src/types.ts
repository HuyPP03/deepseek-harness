/**
 * User MCP server types, free of cordis imports so the RPC layer can shape
 * its wire schemas without loading the service.
 *
 * @module @deepseek-ai/dsh-mcp-manager/types
 */

/** One user MCP server added over a spawned child process (stdio transport). */
export interface StdioServerSpec {
  /**
   * Stable local server namespace for the server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`); must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across every live mcp-client instance.
   */
  readonly serverName: string
  /** Selects the child-process stdio transport. */
  readonly transport: 'stdio'
  /** Executable used to start the server. */
  readonly command: string
  /** Arguments passed directly, without shell interpolation; defaults to none. */
  readonly args?: readonly string[]
  /** Extra env vars merged on top of the scrubbed ambient env; defaults to none. */
  readonly env?: Record<string, string>
  /** Working directory for the child process; defaults to the process default. */
  readonly cwd?: string
  /** Per-tool-call timeout in milliseconds; defaults to the mcp-client default. */
  readonly toolCallTimeoutMs?: number
}

/** One user MCP server added over Streamable HTTP (SSE). */
export interface StreamableHttpServerSpec {
  /**
   * Stable local server namespace for the server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`); must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across every live mcp-client instance.
   */
  readonly serverName: string
  /** Selects the Streamable HTTP transport. */
  readonly transport: 'streamable-http'
  /** MCP endpoint URL. */
  readonly url: string
  /** Additional headers attached to MCP requests; defaults to none. */
  readonly headers?: Record<string, string>
  /** Per-tool-call timeout in milliseconds; defaults to the mcp-client default. */
  readonly toolCallTimeoutMs?: number
}

/** One user MCP server as persisted under the harness home. */
export type McpServerSpec = StdioServerSpec | StreamableHttpServerSpec
