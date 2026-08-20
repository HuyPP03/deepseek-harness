/**
 * MCP server registry: the shared read face over the live
 * `@deepseek-ai/dsh-mcp-client` instances in one app. Each client instance
 * reports its server's connection state and registered tools through
 * {@link McpRegistry.report}; consumers (the `/mcp` command) read a snapshot
 * through {@link McpRegistry.servers}.
 *
 * The registry is pull-based: a reporter holds a reader closure that computes
 * the current snapshot on demand, so the bridge never pushes updates at every
 * reconnect transition, and a read during a re-sync never observes a partial
 * generation. The registry owns no lifecycle of its own — a reporter's
 * disposer removes its entry, and a reader that yields nothing is simply
 * absent from the snapshot.
 *
 * @module @deepseek-ai/dsh-mcp-registry
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { McpServerView } from './types.ts'

export type { McpServerStatus, McpServerView, McpToolInfo } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpRegistry: McpRegistry
  }
}

/** Reader closure a reporter holds: computes the server's current snapshot. */
export type McpServerReader = () => McpServerView | undefined

/**
 * Live MCP server registry over one app root.
 */
export class McpRegistry extends Service {
  /** Reporter readers keyed by server namespace, in registration order. */
  private readonly readers = new Map<string, McpServerReader>()

  constructor(ctx: Context) {
    super(ctx, 'mcpRegistry')
  }

  /**
   * Report one MCP server. The reader is pulled on every {@link servers} read;
   * a `null`/`undefined` result removes the server from the snapshot.
   * @param serverName - stable local server namespace, unique across live reporters.
   * @param read - closure computing the server's current snapshot.
   * @returns the exact disposer that removes this reporter.
   */
  report(serverName: string, read: McpServerReader): () => void {
    if (this.readers.has(serverName)) {
      throw new Error(`mcpRegistry: server "${serverName}" is already reported — pick a unique serverName in cordis.yml`)
    }
    this.readers.set(serverName, read)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.readers.delete(serverName)
    }
  }

  /**
   * Snapshot of every reported MCP server, sorted by serverName.
   * @returns the current views; reporters that yield nothing are omitted.
   */
  servers(): readonly McpServerView[] {
    return [...this.readers.values()]
      .map(read => read())
      .filter((view): view is McpServerView => view !== undefined)
      .sort((left, right) => left.serverName < right.serverName ? -1 : 1)
  }
}

export default McpRegistry
