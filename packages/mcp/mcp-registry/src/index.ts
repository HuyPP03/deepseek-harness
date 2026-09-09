/**
 * MCP server registry: the shared read face over the live
 * `@deepseek-ai/dsh-mcp-client` instances in one app. Each client instance
 * reports its server's connection state and registered tools through
 * {@link McpRegistry.report}; consumers (the `/mcp` command) read a snapshot
 * through {@link McpRegistry.servers}, and surfaces that can act on a server
 * (the `mcp.reconnect` RPC) use {@link McpRegistry.reconnect}.
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

import { CallId } from '@deepseek-ai/dsh-llm'
import { Context, Service } from '@deepseek-ai/cordis'
import { createBridgeTools, type BridgeFaces } from './bridge.ts'
import type { McpServerView } from './types.ts'

export type { McpServerStatus, McpServerView, McpToolInfo } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpRegistry: McpRegistry
  }
}

/** Reader closure a reporter holds: computes the server's current snapshot. */
export type McpServerReader = () => McpServerView | undefined

/** Thrown when a manual reconnect targets a server that is not currently reported. */
export class McpServerNotReportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpServerNotReportedError'
  }
}

/** One reporter's registration: its snapshot reader plus the operations its backend supports. */
export interface McpServerReporter {
  /** Closure computing the server's current snapshot; pulled on every {@link McpRegistry.servers} read. */
  readonly read: McpServerReader
  /**
   * Manual reconnect hook, present when the backend supports an explicit
   * retry. The registry passes the call through and awaits it; it never
   * interprets the result — the hook's own settlement is the completion
   * signal, and the next {@link McpRegistry.servers} read observes the new
   * status.
   */
  readonly reconnect?: () => Promise<void>
}

/**
 * Live MCP server registry over one app root. Besides the read face, the
 * registry registers the model-facing MCP bridge (`mcp_list`,
 * `mcp_describe`, `mcp_call`) once per app: the per-server tools the mcp
 * clients register are unlisted, so a large MCP tool surface never enters the
 * request `tools` array and the model reaches each tool on demand instead.
 */
export class McpRegistry extends Service {
  static inject = ['tools']

  /** Reporters keyed by server namespace, in registration order. */
  private readonly reporters = new Map<string, McpServerReporter>()

  constructor(ctx: Context) {
    super(ctx, 'mcpRegistry')
  }

  /**
   * Register the three bridge tools over this registry's faces. Each
   * registration rides a ctx effect so disposing the service removes it.
   */
  protected [Service.init](): Promise<void> {
    const tools = this.ctx.tools
    const faces: BridgeFaces = {
      servers: () => this.servers(),
      target: (name) => {
        const definition = tools.get(name)
        return definition?.unlisted === true && definition.name.startsWith('mcp__') ? definition : undefined
      },
      dispatch: async (name, args, exec) => {
        const result = await tools.execute({
          callId: CallId(`mcp-call-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          name,
          arguments: args,
          ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
          parent: exec.token,
          signal: exec.signal,
        })
        return result.isError
          ? { isError: true, message: result.error.message, content: result.content }
          : { isError: false, value: result.value, message: '', content: result.content }
      },
    }
    const bridge = createBridgeTools(faces)
    for (const [label, definition] of [
      ['mcp_list', bridge.list],
      ['mcp_describe', bridge.describe],
      ['mcp_call', bridge.call],
    ] as const) {
      this.ctx.effect(() => tools.register(definition), `mcp-registry: ${label}`)
    }
    return Promise.resolve()
  }

  /**
   * Report one MCP server. The reader is pulled on every {@link servers} read;
   * a `null`/`undefined` result removes the server from the snapshot.
   * @param serverName - stable local server namespace, unique across live reporters.
   * @param reporter - snapshot reader plus optional operations (reconnect).
   * @returns the exact disposer that removes this reporter.
   */
  report(serverName: string, reporter: McpServerReporter): () => void {
    if (this.reporters.has(serverName)) {
      throw new Error(`mcpRegistry: server "${serverName}" is already reported — pick a unique serverName in cordis.yml`)
    }
    this.reporters.set(serverName, reporter)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.reporters.delete(serverName)
    }
  }

  /**
   * Snapshot of every reported MCP server, sorted by serverName.
   * @returns the current views; reporters that yield nothing are omitted.
   */
  servers(): readonly McpServerView[] {
    return [...this.reporters.values()]
      .map(reporter => reporter.read())
      .filter((view): view is McpServerView => view !== undefined)
      .sort((left, right) => left.serverName < right.serverName ? -1 : 1)
  }

  /**
   * Ask one reported server to start a manual reconnect.
   *
   * @param serverName - stable local server namespace.
   * @throws {McpServerNotReportedError} when the server is not currently reported.
   * @returns once the reporter's reconnect hook has settled. A reporter
   *   without a hook resolves as a no-op: its snapshot has nothing behind it
   *   to reconnect.
   */
  async reconnect(serverName: string): Promise<void> {
    const reporter = this.reporters.get(serverName)
    if (reporter === undefined) {
      throw new McpServerNotReportedError(`mcpRegistry: server "${serverName}" is not reported`)
    }
    await reporter.reconnect?.()
  }
}

export default McpRegistry
