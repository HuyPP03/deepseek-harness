/**
 * The connector device-code flow engine (`ctx.deviceFlow`): the host-side
 * half of a `device` auth method. `begin` drives the provider's server-side
 * login tool on the connector's mounted MCP server; when the provider
 * returns a device-code instruction (a URL and a one-time code), the engine
 * polls the provider's server-side verify tool in the background until the
 * sign-in settles or the window closes. A provider that reports the account
 * already signed in settles without a code. The engine never stores a
 * credential: the MCP server owns its token cache.
 * @module @deepseek-ai/dsh-connectors-device-flow
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Connectors, DeviceFlowStart } from '@deepseek-ai/dsh-connectors'
import { CallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { McpManager } from '@deepseek-ai/dsh-mcp-manager'
import z from '@deepseek-ai/schemastery'

/**
 * The MCP public tool name for one server and raw tool name: the clean case
 * is `mcp__<serverName>__<rawName>` verbatim, truncated to the 64-character
 * function-name contract.
 * @param serverName - the server's stable namespace.
 * @param rawName - the MCP server's own tool name.
 * @returns the globally unique, model-facing tool name.
 */
function publicToolName(serverName: string, rawName: string): string {
  return `mcp__${serverName}__${rawName}`.slice(0, 64)
}

/** Plugin config: the flow window and the verify poll cadence. */
export interface Config {
  /** How long one flow may wait for the sign-in; defaults to 900000 (15 minutes). */
  flowTimeoutMs?: number
  /** How often the verify tool is polled; defaults to 5000 (5 seconds). */
  pollIntervalMs?: number
}

/** Fully resolved engine parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  flowTimeoutMs: number
  pollIntervalMs: number
}

function resolveSpec(config: Config): ResolvedSpec {
  return {
    flowTimeoutMs: config.flowTimeoutMs ?? 900_000,
    pollIntervalMs: config.pollIntervalMs ?? 5_000,
  }
}

/** The one-time code the user enters, from the provider's message. */
const USER_CODE_PATTERN = /the code ([A-Z0-9-]{4,}) to authenticate/i
/** The sign-in page to open, from the provider's message. */
const VERIFICATION_URL_PATTERN = /open the page (\S+)/i

/** The in-flight half of one connector's device flow. */
interface InFlight {
  /** The connector's server that hosts the login and verify tools. */
  serverName: string
  /** The verify tool's public MCP name. */
  verifyName: string
  /** The timeout that fails the flow when the window closes. */
  timeout: NodeJS.Timeout
  /** The pending poll timer, absent between polls. */
  poll: NodeJS.Timeout | null
  /** Set when the flow settled or was canceled; no further work runs. */
  settled: boolean
}

/**
 * The parsed login tool result. The provider's JSON carries either a
 * success status, a device-code instruction, or an error.
 */
interface LoginResult {
  readonly success?: boolean
  readonly status?: string
  readonly error?: string
  readonly message?: string
}

/**
 * Parse the login tool's text result. A JSON parse failure is a failure:
 * the provider's message is the flow's contract.
 * @param text - the tool result's text block.
 * @returns the parsed result.
 * @throws when the text is not a parseable JSON object.
 */
function parseLoginResult(text: string): LoginResult {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const result: Record<string, unknown> = {}
    if (typeof parsed.success === 'boolean') result.success = parsed.success
    if (typeof parsed.status === 'string') result.status = parsed.status
    if (typeof parsed.error === 'string') result.error = parsed.error
    if (typeof parsed.message === 'string') result.message = parsed.message
    return result as LoginResult
  } catch {
    throw new Error(`device-flow: the login tool returned no parseable JSON (${text.slice(0, 80)})`)
  }
}

/**
 * Extract the device-code facts from the provider's message.
 * @param message - the provider's sign-in instruction.
 * @returns the verification URL and user code, or `undefined` when the
 *   message carries no parseable pair.
 */
function deviceCodeFrom(message: string): { verificationUri: string; userCode: string } | undefined {
  const url = message.match(VERIFICATION_URL_PATTERN)?.[1]
  const code = message.match(USER_CODE_PATTERN)?.[1]
  if (url === undefined || code === undefined) return undefined
  return { verificationUri: url, userCode: code }
}

/**
 * Drives one connector's device-code flow: the login tool call, the
 * device-code parse, and the verify poll loop. The connectors service mounts
 * the connector's servers before `begin` and settles the state when the
 * flow completes.
 */
export class DeviceFlowEngine extends Service {
  static inject = ['tools']
  static Config: z<Config> = z.object({
    flowTimeoutMs: z.number().min(1000).default(900_000),
    pollIntervalMs: z.number().min(100).default(5_000),
  })

  private readonly spec: ResolvedSpec
  /** In-flight flows, keyed by connector id: one flow per connector. */
  private readonly inFlight = new Map<string, InFlight>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'deviceFlow')
    this.spec = resolveSpec(config)
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield async () => {
      for (const id of [...this.inFlight.keys()]) this.teardown(id)
      await Promise.resolve()
    }
    await Promise.resolve()
  }

  /**
   * Begin one connector's device-code flow over its mounted server: drive
   * the login tool, parse the provider's sign-in instruction, and — for a
   * device-code start — start the background verify poll. A provider that
   * reports the account already signed in settles immediately.
   *
   * @param id - the connector id with a `device` auth method.
   * @returns the start facts for the client to show.
   * @throws when the flow seams are missing, the method is absent, a flow is
   *   already in flight, the server is not mounted, or the login tool fails.
   */
  async begin(id: string): Promise<DeviceFlowStart> {
    if (this.inFlight.has(id)) throw new Error(`device-flow: a flow for "${id}" is already in flight`)
    const connectors = this.requireConnectors()
    const manifest = connectors.manifest(id)
    if (manifest === undefined) throw new Error(`device-flow: unknown connector "${id}"`)
    const method = manifest.auth.find(entry => entry.mode === 'device')
    if (method === undefined) throw new Error(`device-flow: connector "${id}" supports no device auth`)
    if (method.loginTool === undefined || method.verifyTool === undefined) {
      throw new Error(`device-flow: connector "${id}" declares no device login/verify tool`)
    }
    const server = manifest.servers[0]
    /* v8 ignore next -- the manifest validator requires servers to be non-empty */
    if (server === undefined) throw new Error(`device-flow: connector "${id}" declares no server`)
    const mounted = this.mcpManager.servers().find(entry => entry.serverName === server.serverName)
    if (mounted === undefined) throw new Error(`device-flow: the connector's server "${server.serverName}" is not mounted`)

    connectors.setAuthorizing(id, true)
    const loginName = publicToolName(server.serverName, method.loginTool)
    const verifyName = publicToolName(server.serverName, method.verifyTool)
    let started: DeviceFlowStart | undefined
    try {
      const result = await this.callTool(loginName, {})
      const text = result.content.find(block => block.type === 'text')?.text
      if (result.isError || text === undefined) {
        throw new Error('device-flow: the login tool returned no result')
      }
      const parsed = parseLoginResult(text)
      if (parsed.success === true || parsed.status === 'Already logged in' || parsed.status === 'Login successful') {
        // The server was already authenticated: settle without a code.
        connectors.setAuthorizing(id, false)
        await connectors.settleAuthFlow(id)
        return { status: 'ready', expiresAt: Date.now() }
      }
      if (parsed.error !== undefined && parsed.error !== 'device_code_required') {
        throw new Error(`device-flow: the login tool reported "${parsed.error}"${parsed.message !== undefined ? `: ${parsed.message}` : ''}`)
      }
      const code = parsed.message !== undefined ? deviceCodeFrom(parsed.message) : undefined
      if (code === undefined) {
        throw new Error('device-flow: the login tool returned a device-code start without a parseable sign-in instruction')
      }
      started = {
        status: 'device-code',
        verificationUri: code.verificationUri,
        ...(code.userCode !== undefined ? { userCode: code.userCode } : {}),
        ...(parsed.message !== undefined ? { message: parsed.message } : {}),
        expiresAt: Date.now() + this.spec.flowTimeoutMs,
      }
    } catch (error) {
      connectors.setAuthorizing(id, false)
      throw error
    }
    const flow: InFlight = {
      serverName: server.serverName,
      verifyName,
      timeout: setTimeout(() => { this.teardown(id, 'the device sign-in window closed before it completed') }, this.spec.flowTimeoutMs),
      poll: null,
      settled: false,
    }
    this.inFlight.set(id, flow)
    void this.pollOnce(id, flow)
    if (started === undefined) throw new Error('device-flow: invariant — started is undefined')
    return started
  }

  /**
   * Cancel one in-flight flow without recording an error: polling stops, the
   * authorizing flag clears, and the connector's servers unmount.
   * @param id - the connector id.
   */
  cancel(id: string): void {
    this.teardown(id)
  }

  /**
   * One verify poll: call the verify tool; on success settle the flow, on a
   * tool error fail it, otherwise schedule the next poll.
   * @param id - the connector id.
   * @param flow - the in-flight state.
   */
  private async pollOnce(id: string, flow: InFlight): Promise<void> {
    if (flow.settled) return
    let result: { isError: boolean; content: readonly ContentBlock[] }
    try {
      result = await this.callTool(flow.verifyName, {})
    } catch (error) {
      this.teardown(id, `the verify tool call failed (${errorMessage(error)})`)
      return
    }
    if (flow.settled) return
    const text = result.content.find(block => block.type === 'text')?.text
    const parsed = text !== undefined ? safeParse(text) : undefined
    const success = parsed !== undefined && (parsed.success === true || parsed.status === 'Already logged in' || parsed.status === 'Login successful')
    if (success) {
      this.settleSuccess(id, flow)
      return
    }
    if (result.isError) {
      this.teardown(id, 'the verify tool reported an error')
      return
    }
    flow.poll = setTimeout(() => { void this.pollOnce(id, flow) }, this.spec.pollIntervalMs)
  }

  /**
   * Settle a successful flow: clear the timers and the in-flight record,
   * clear the authorizing flag, and republish the connector's state. The
   * server stays mounted — it is authenticated.
   * @param id - the connector id.
   * @param flow - the in-flight state.
   */
  private settleSuccess(id: string, flow: InFlight): void {
    flow.settled = true
    this.inFlight.delete(id)
    clearTimeout(flow.timeout)
    if (flow.poll !== null) clearTimeout(flow.poll)
    const connectors = this.ctx.get('connectors')
    if (connectors === undefined) return
    connectors.setAuthorizing(id, false)
    /* v8 ignore next -- settle republishes; a failed publish cannot roll back the sign-in */
    void connectors.settleAuthFlow(id).catch(() => {})
  }

  /**
   * Tear down one flow: clear the timers and the in-flight record, clear the
   * authorizing flag, unmount the connector's servers, and — when a message
   * is given — record the failure.
   * @param id - the connector id.
   * @param message - the failure to surface, or `undefined` for a cancel.
   */
  private teardown(id: string, message?: string): void {
    const flow = this.inFlight.get(id)
    if (flow === undefined) return
    flow.settled = true
    this.inFlight.delete(id)
    clearTimeout(flow.timeout)
    if (flow.poll !== null) clearTimeout(flow.poll)
    const connectors = this.ctx.get('connectors')
    if (connectors === undefined) return
    connectors.setAuthorizing(id, false)
    /* v8 ignore next -- the mount belongs to the connectors service; unmount through its public surface */
    void this.unmount(id).catch(() => {})
    if (message !== undefined) {
      /* v8 ignore next -- a failed record cannot roll back the settled flow */
      void connectors.recordFlowFailure(id, message).catch(() => {})
    }
  }

  /**
   * Unmount one connector's servers after a failed or canceled flow.
   * @param id - the connector id.
   */
  private async unmount(id: string): Promise<void> {
    const connectors = this.ctx.get('connectors')
    if (connectors === undefined) return
    const manifest = connectors.manifest(id)
    if (manifest === undefined) return
    for (const server of manifest.servers) {
      if (this.mcpManager.userServers().includes(server.serverName)) {
        await this.mcpManager.remove(server.serverName)
      }
    }
  }

  /**
   * Call one tool through the tool runtime and return its result.
   * @param name - the public tool name.
   * @param args - the tool arguments.
   * @returns the materialized result.
   */
  private async callTool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; content: readonly ContentBlock[] }> {
    const result = await this.ctx.tools.execute({
      callId: CallId(`device-flow-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      name,
      arguments: args,
      signal: new AbortController().signal,
    })
    return { isError: result.isError, content: result.content }
  }

  /** The MCP manager service, read through the service store. */
  private get mcpManager(): McpManager {
    const manager = this.ctx.get('mcpManager')
    if (manager === undefined) throw new Error('device-flow: the deployment composes no mcp-manager service')
    return manager
  }

  /** The connectors service, or a loud error. */
  private requireConnectors(): Connectors {
    const connectors = this.ctx.get('connectors')
    if (connectors === undefined) throw new Error('device-flow: the deployment composes no connectors service')
    return connectors
  }
}

/** Best-effort parse that never throws. */
function safeParse(text: string): LoginResult | undefined {
  try {
    return parseLoginResult(text)
  } catch {
    return undefined
  }
}

/** Best-effort message from an arbitrary thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default DeviceFlowEngine
