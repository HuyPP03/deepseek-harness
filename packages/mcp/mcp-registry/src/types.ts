/**
 * MCP server status and tool snapshot types, free of cordis imports so
 * consumers can read the registry's view without loading the service.
 *
 * @module @deepseek-ai/dsh-mcp-registry/types
 */

/** Connection lifecycle state of one reported MCP server. */
export type McpServerStatus = 'connecting' | 'connected' | 'reconnecting' | 'down'

/** One MCP tool as registered on the harness tool registry. */
export interface McpToolInfo {
  /** The model-facing public name (`mcp__<serverName>__<rawName>` or its normalized form). */
  readonly name: string
  /** The server-provided tool description. */
  readonly description: string
}

/** Current snapshot of one reported MCP server. */
export interface McpServerView {
  /** Stable local server namespace the reporter was configured with. */
  readonly serverName: string
  /** Lifecycle state of the server's connection. */
  readonly status: McpServerStatus
  /** The server's tools currently registered on the tool registry. */
  readonly tools: readonly McpToolInfo[]
}
