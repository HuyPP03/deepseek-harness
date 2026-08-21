/**
 * User MCP server manager: the owner of the user-added MCP servers in one
 * app. Each user server is persisted as one `<serverName>.cordis.yml` file
 * under the harness home's `.mcp/` directory (default `$DSH_HOME/.mcp`),
 * holding a single `mcp-client` entry, and mounted as a live `mcp-client`
 * instance into the host plane at startup and on `add`.
 *
 * The manager owns its own files only: servers declared in a profile or the
 * host composition are not removable through it, though every server —
 * profile-declared and user-managed alike — reports into the same
 * `mcp-registry`, and this service's `servers`/`reconnect` faces read through
 * to it over the union.
 *
 * A persisted file that cannot be loaded fails the boot loud (like any other
 * composition input); an `add` whose mount fails deletes the file it just
 * wrote, so a failed add leaves no trace.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, type Fiber, Service } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-registry'
import z from '@deepseek-ai/schemastery'
import { parse, stringify } from 'yaml'

export type { McpServerSpec, StdioServerSpec, StreamableHttpServerSpec } from './types.ts'
import type { McpServerSpec } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpManager: McpManager
  }
}

/** McpManager config; the Loader validates before the constructor runs. */
export interface Config {
  /** Directory holding one cordis.yml per user MCP server; defaults to `.mcp` under the harness home. */
  readonly mcpDir?: string
}

/**
 * Thrown by {@link McpManager.add} when the serverName is already taken —
 * either managed by this manager or reported by another mcp-client instance.
 */
export class McpServerExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpServerExistsError'
  }
}

/** Thrown by {@link McpManager.remove} when the server is not user-managed. */
export class McpServerNotManagedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpServerNotManagedError'
  }
}

/** The npm specifier persisted in user server documents, matching the profile form. */
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

/** The mcp-client runtime the manager mounts for every user server. */
const MCP_CLIENT_RUNTIME = {
  name: mcpClient.name,
  inject: mcpClient.inject,
  apply: mcpClient.apply,
  Config: mcpClient.Config,
}

/** The one file extension user server documents use; anything else in the directory is ignored. */
const SERVER_FILE_SUFFIX = '.cordis.yml'

/**
 * Resolve one user-facing server spec into the full mcp-client config the
 * manager mounts: the spec carries only the user's fields, and every field the
 * user does not choose falls back to the mcp-client default the schema would
 * apply, so the mounted instance is byte-identical to the persisted document.
 * @param spec - the user-facing server definition.
 * @returns the resolved mcp-client config.
 */
function toClientConfig(spec: McpServerSpec): McpClientConfig {
  if (spec.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: spec.serverName,
      command: spec.command,
      args: [...(spec.args ?? [])],
      env: { ...spec.env },
      cwd: spec.cwd ?? '',
      toolCallTimeoutMs: spec.toolCallTimeoutMs ?? mcpClient.DEFAULT_TOOL_CALL_TIMEOUT_MS,
      failOnStartupError: false,
    }
  }
  return {
    transport: 'streamable-http',
    serverName: spec.serverName,
    url: spec.url,
    headers: { ...spec.headers },
    toolCallTimeoutMs: spec.toolCallTimeoutMs ?? mcpClient.DEFAULT_TOOL_CALL_TIMEOUT_MS,
    failOnStartupError: false,
  }
}

/**
 * Resolve the raw config: an explicit `mcpDir` is expanded and made absolute,
 * omission falls back to the harness home's `.mcp` directory.
 * @param config - raw plugin config; a programmatic caller may bypass the schema.
 * @returns the resolved directory the manager reads and writes.
 */
export function resolveConfig(config: Config = {}): { readonly mcpDir: string } {
  return {
    mcpDir: config.mcpDir !== undefined ? resolve(expandHomePath(config.mcpDir)) : dshHomePath('.mcp'),
  }
}

/**
 * Live user MCP servers plus the runtime operations over them.
 */
export class McpManager extends Service {
  static inject = ['mcpRegistry']
  static Config: z<Config> = z.object({
    mcpDir: z.string(),
  })

  private readonly dir: string
  /** User servers currently mounted, keyed by serverName. */
  private readonly mounts = new Map<string, Fiber>()
  /**
   * The raw service fiber context. Child mounts must originate from it: the
   * traceable `this.ctx` handed to external callers shadows the parent chain,
   * and a fiber extended from a shadowed context loses its injected services.
   */
  private readonly owner: Context

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpManager')
    this.owner = ctx
    this.dir = resolveConfig(config).mcpDir
  }

  /**
   * Mount every persisted user server before the service becomes injectable.
   * @throws when a persisted file cannot be parsed or its mcp-client instance fails to load.
   */
  protected async [Service.init](): Promise<void> {
    for (const file of await this.listFiles()) {
      const serverName = file.slice(0, -SERVER_FILE_SUFFIX.length)
      const spec = await this.readSpec(file)
      await this.mount(serverName, spec)
    }
  }

  /**
   * Snapshot of every reported MCP server — profile-declared and user-managed
   * alike — sorted by serverName.
   * @returns the live registry views.
   */
  servers(): readonly McpServerView[] {
    return this.ctx.mcpRegistry.servers()
  }

  /**
   * The serverNames this manager currently mounts from its own directory.
   * @returns the sorted managed names.
   */
  userServers(): readonly string[] {
    return [...this.mounts.keys()].sort()
  }

  /**
   * Persist one server under the manager's directory and mount it.
   *
   * @param spec - the server definition to add.
   * @throws when the serverName is already managed or already reported by
   *   another mcp-client instance, or when the mount fails — in that case the
   *   file written for this call is deleted again.
   */
  async add(spec: McpServerSpec): Promise<void> {
    const { serverName } = spec
    if (this.mounts.has(serverName)) {
      throw new McpServerExistsError(`mcp-manager: server "${serverName}" is already managed`)
    }
    // The registry is the cross-origin uniqueness authority: a profile-mounted
    // instance with the same name must refuse the add, not be shadowed.
    if (this.ctx.mcpRegistry.servers().some(view => view.serverName === serverName)) {
      throw new McpServerExistsError(`mcp-manager: serverName "${serverName}" is already reported by another mcp-client instance`)
    }
    await this.writeFile(serverName, spec)
    try {
      await this.mount(serverName, spec)
    } catch (error) {
      await this.removeFile(serverName)
      throw error
    }
  }

  /**
   * Unmount one user server and delete its file.
   * @param serverName - the managed server to remove.
   * @throws when the server is not one of the manager's own.
   */
  async remove(serverName: string): Promise<void> {
    const fiber = this.mounts.get(serverName)
    if (fiber === undefined) {
      throw new McpServerNotManagedError(`mcp-manager: server "${serverName}" is not a user-managed server`)
    }
    this.mounts.delete(serverName)
    await fiber.dispose()
    await this.removeFile(serverName)
  }

  /**
   * Ask one reported server to start a manual reconnect — profile-declared
   * and user-managed alike.
   * @param serverName - the server to reconnect.
   * @throws when no mcp-client reports that server.
   */
  async reconnect(serverName: string): Promise<void> {
    await this.ctx.mcpRegistry.reconnect(serverName)
  }

  /** Mount one mcp-client instance for `spec` and track it by name. */
  private async mount(serverName: string, spec: McpServerSpec): Promise<void> {
    let fiber: Fiber
    try {
      fiber = this.owner.plugin(MCP_CLIENT_RUNTIME, toClientConfig(spec))
      await fiber.await()
    } catch (error) {
      throw new Error(`mcp-manager: mounting user server "${serverName}" failed: ${String(error)}`, { cause: error })
    }
    this.mounts.set(serverName, fiber)
  }

  /** One server's file path inside the manager's directory. */
  private filePath(serverName: string): string {
    return join(this.dir, `${serverName}${SERVER_FILE_SUFFIX}`)
  }

  /** The server file basenames currently present, sorted. */
  private async listFiles(): Promise<string[]> {
    let entries
    try {
      entries = await readdir(this.dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith(SERVER_FILE_SUFFIX))
      .map(entry => entry.name)
      .sort()
  }

  /** Read and validate one server document into its mcp-client config. */
  private async readSpec(fileName: string): Promise<McpServerSpec> {
    const raw = await readFile(this.filePathForName(fileName), 'utf8')
    let document: unknown
    try {
      document = parse(raw)
    } catch (error) {
      throw new Error(`mcp-manager: ${fileName} is not valid YAML: ${String(error)}`, { cause: error })
    }
    if (!Array.isArray(document) || document.length === 0) {
      throw new Error(`mcp-manager: ${fileName} must hold one entry list`)
    }
    const entry: unknown = document[0]
    if (typeof entry !== 'object' || entry === null
      || (entry as { name?: unknown }).name !== MCP_CLIENT_PACKAGE
      || typeof (entry as { config?: unknown }).config !== 'object'
      || (entry as { config: unknown }).config === null) {
      throw new Error(`mcp-manager: ${fileName} must hold a single ${MCP_CLIENT_PACKAGE} entry`)
    }
    return (entry as { config: McpServerSpec }).config
  }

  /** Join a bare filename from listFiles() against the directory. */
  private filePathForName(name: string): string {
    return join(this.dir, name)
  }

  /** Write one server's persisted document (0600: headers/env may carry secrets). */
  private async writeFile(serverName: string, spec: McpServerSpec): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const entry = [
      {
        id: `mcp-client-${serverName}`,
        name: MCP_CLIENT_PACKAGE,
        config: spec,
      },
    ]
    await writeFile(this.filePath(serverName), stringify(entry, { lineWidth: 0 }), { mode: 0o600 })
  }

  /** Delete one server's persisted document. */
  private async removeFile(serverName: string): Promise<void> {
    await rm(this.filePath(serverName))
  }
}

export default McpManager
