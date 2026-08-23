/**
 * Engine suite for the connector device-code flow: the login tool call, the
 * device-code parse, the background verify poll, and the settle paths
 * (success, timeout, cancel). A fake ToolRuntime stands in for the tool seam
 * so the suite never spawns a process; the connectors service is real, so
 * the authorizing flag and the settle publish are observed through the
 * seams the engine settles through.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { McpServerExistsError, type McpServerSpec } from '@deepseek-ai/dsh-mcp-manager'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Connectors from '@deepseek-ai/dsh-connectors'
import DeviceFlowEngine from '../src/index.ts'

type McpServerView = { serverName: string; status: 'connecting' | 'connected' | 'reconnecting' | 'down'; tools: readonly unknown[] }

/**
 * Mount seam for the suite: records the server specs the connectors service
 * hands over and reports every mounted server as connected.
 */
class FakeMcpManager extends Service {
  readonly specs: McpServerSpec[] = []
  readonly removed: string[] = []
  private mounted: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'mcpManager')
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield () => {
      this.mounted = []
      this.specs.length = 0
      this.removed.length = 0
    }
  }

  add = (spec: McpServerSpec): Promise<void> => {
    if (this.mounted.includes(spec.serverName)) return Promise.reject(new McpServerExistsError(`fake-manager: server "${spec.serverName}" is already managed`))
    this.mounted = [...this.mounted, spec.serverName].sort()
    this.specs.push(spec)
    return Promise.resolve()
  }

  remove = (serverName: string): Promise<void> => {
    const index = this.specs.findIndex(entry => entry.serverName === serverName)
    if (index !== -1) this.specs.splice(index, 1)
    this.mounted = this.mounted.filter(name => name !== serverName)
    this.removed.push(serverName)
    return Promise.resolve()
  }

  servers = (): readonly McpServerView[] => this.specs.map(spec => ({
    serverName: spec.serverName,
    status: 'connected' as const,
    tools: [],
  }))

  userServers = (): readonly string[] => this.mounted
}

/**
 * Tool seam for the suite: records the tool calls the engine makes and
 * returns scripted results. The login and verify tools are keyed by their
 * public names.
 */
class FakeToolRuntime extends Service {
  readonly calls: Array<{ name: string; args: unknown }> = []
  /** Scripted results, keyed by tool name; the last entry wins. */
  results = new Map<string, ToolExecutionResult>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield () => {
      this.calls.length = 0
      this.results.clear()
    }
  }

  execute = async (exec: ToolExecutionInput): Promise<ToolExecutionResult> => {
    this.calls.push({ name: exec.name, args: exec.arguments })
    const result = this.results.get(exec.name)
    if (result === undefined) throw new Error(`fake-tools: no scripted result for "${exec.name}"`)
    return result
  }
}

function successResult(text: string): ToolExecutionResult {
  return { isError: false, value: null, content: [{ type: 'text', text }] }
}

function failureResult(text: string): ToolExecutionResult {
  return { isError: true, error: { code: 'ERROR', message: text }, content: [{ type: 'text', text }] }
}

const M365_YML = [
  'id: m365',
  'name: Microsoft 365',
  'description: Outlook, OneDrive, and Teams on Microsoft 365.',
  'presetId: m365',
  'workspaceDirName: m365',
  'auth:',
  '  - mode: device',
  '    loginTool: login',
  '    verifyTool: verify-login',
  'servers:',
  '  - serverName: m365',
  '    transport: stdio',
  '    command: npx',
  "    args: ['-y', '@softeria/ms-365-mcp-server']",
  '',
].join('\n')

const NO_TOOL_YML = [
  'id: notool',
  'name: No Tool',
  'description: A device connector without tools.',
  'presetId: notool',
  'workspaceDirName: notool',
  'auth:',
  '  - mode: device',
  'servers:',
  '  - serverName: notool',
  '    transport: stdio',
  '    command: node',
  '    args: [fixture]',
  '',
].join('\n')

const fibers: Array<{ dispose: () => Promise<void> }> = []

function track(fiber: { dispose: () => Promise<void> }): typeof fiber {
  fibers.push(fiber)
  return fiber
}

async function tempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

interface BootOptions {
  flowTimeoutMs?: number
  pollIntervalMs?: number
  extraCatalog?: Array<[string, string]>
}

async function boot(
  options: BootOptions = {},
): Promise<{ ctx: Context; engine: DeviceFlowEngine; tools: FakeToolRuntime; manager: FakeMcpManager }> {
  const root = await tempDir('root')
  const catalogDir = join(root, 'catalog')
  const userDir = join(root, 'user')
  const systemPresets = join(root, 'presets')
  await mkdir(catalogDir, { recursive: true })
  await mkdir(join(systemPresets, 'custom'), { recursive: true })
  await writeFile(join(catalogDir, 'm365.yml'), M365_YML)
  await writeFile(join(catalogDir, 'notool.yml'), NO_TOOL_YML)
  for (const [name, content] of options.extraCatalog ?? []) {
    await writeFile(join(catalogDir, `${name}.yml`), content)
  }
  await writeFile(join(systemPresets, 'custom', 'agent.cordis.yml'), '- id: stub\n  name: test:stub-preset\n')
  const home = await tempDir('home')
  vi.stubEnv('DSH_HOME', home)

  const ctx = new Context()
  await track(ctx.plugin(Loader))
  ctx.loader.builtins.include = Include
  await track(ctx.plugin(SystemPrompt))
  const tools = new FakeToolRuntime(ctx)
  await track(ctx.plugin(AgentPresets, {
    default: 'custom',
    roots: [{ path: systemPresets, trust: 'system' }],
    includeUserRoot: true,
  }))
  const manager = new FakeMcpManager(ctx)
  await track(ctx.plugin(Connectors, { catalogDir, userDir }))
  await track(ctx.plugin(DeviceFlowEngine, {
    ...(options.flowTimeoutMs !== undefined ? { flowTimeoutMs: options.flowTimeoutMs } : {}),
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
  }))
  return { ctx, engine: ctx.deviceFlow as DeviceFlowEngine, tools, manager }
}

async function poll(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
}

async function viewOf(ctx: Context, id: string): Promise<{ state: string; lastError?: string }> {
  const view = await ctx.connectors.get(id)
  if (view === undefined) throw new Error(`no view for ${id}`)
  return view
}

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop()!
    await fiber.dispose()
  }
  vi.unstubAllEnvs()
})

describe('device-flow engine', () => {
  it('refuses a begin for an unknown connector', async () => {
    const { engine } = await boot()
    await expect(engine.begin('nope')).rejects.toThrow('unknown connector')
  })

  it('refuses a begin for a connector with no device method', async () => {
    const { engine } = await boot({ extraCatalog: [['token', 'id: token\nname: Token\ndescription: t.\npresetId: token\nworkspaceDirName: token\nauth:\n  - mode: token\n    credentialRefs: [T]\nservers:\n  - serverName: token\n    transport: stdio\n    command: node\n']] })
    await expect(engine.begin('token')).rejects.toThrow('supports no device auth')
  })

  it('refuses a begin for a device method without login/verify tools', async () => {
    const { engine } = await boot()
    await expect(engine.begin('notool')).rejects.toThrow('declares no device login/verify tool')
  })

  it('refuses a begin when the server is not mounted', async () => {
    const { engine } = await boot()
    await expect(engine.begin('m365')).rejects.toThrow('is not mounted')
  })

  it('refuses a second begin while a flow is in flight', async () => {
    const { engine, tools, manager } = await boot()
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message: 'To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code ABC-123 to authenticate.' })))
    tools.results.set('mcp__m365__verify-login', successResult(JSON.stringify({ success: false })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await expect(engine.begin('m365')).resolves.toMatchObject({ status: 'device-code', verificationUri: 'https://login.microsoft.com/device', userCode: 'ABC-123' })
    await expect(engine.begin('m365')).rejects.toThrow('already in flight')
    engine.cancel('m365')
  })

  it('settles immediately when the login tool reports the account already signed in', async () => {
    const { ctx, engine, tools, manager } = await boot()
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ status: 'Already logged in' })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    const started = await engine.begin('m365')
    expect(started.status).toBe('ready')
    const view = await viewOf(ctx, 'm365')
    expect(view.state).toBe('connected')
  })

  it('parses the device-code start and returns the verification facts', async () => {
    const { engine, tools, manager } = await boot()
    const message = 'To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code XYZ-789 to authenticate.\nAfter login run the "verify login" command'
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message })))
    tools.results.set('mcp__m365__verify-login', successResult(JSON.stringify({ success: false })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    const started = await engine.begin('m365')
    expect(started).toMatchObject({
      status: 'device-code',
      verificationUri: 'https://login.microsoft.com/device',
      userCode: 'XYZ-789',
      message,
    })
    expect(started.expiresAt).toBeGreaterThan(Date.now())
    engine.cancel('m365')
  })

  it('fails the begin when the login tool reports an error', async () => {
    const { ctx, engine, tools, manager } = await boot()
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'Authentication failed: bad network' })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await expect(engine.begin('m365')).rejects.toThrow('Authentication failed: bad network')
    const view = await viewOf(ctx, 'm365')
    expect(view.state).not.toBe('authorizing')
  })

  it('fails the begin when the login tool returns no text', async () => {
    const { engine, tools, manager } = await boot()
    tools.results.set('mcp__m365__login', { isError: false, value: null, content: [] })
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await expect(engine.begin('m365')).rejects.toThrow('returned no result')
  })

  it('fails the begin when the login tool returns non-JSON text', async () => {
    const { engine, tools, manager } = await boot()
    tools.results.set('mcp__m365__login', successResult('not json'))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await expect(engine.begin('m365')).rejects.toThrow('no parseable JSON')
  })

  it('fails the begin when the device-code message carries no URL', async () => {
    const { engine, tools, manager } = await boot()
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message: 'no url here' })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await expect(engine.begin('m365')).rejects.toThrow('without a parseable sign-in instruction')
  })

  it('settles the flow when the verify poll succeeds', async () => {
    const { ctx, engine, tools, manager } = await boot({ pollIntervalMs: 100 })
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message: 'open the page https://login.microsoft.com/device and enter the code ABC-123 to authenticate' })))
    let verifyCalls = 0
    tools.results.set('mcp__m365__verify-login', {
      get: undefined,
      isError: false, value: null,
      content: [],
    } as ToolExecutionResult)
    // Override the verify result to succeed on the second call.
    const originalExecute = tools.execute
    tools.execute = async (exec: ToolExecutionInput) => {
      if (exec.name === 'mcp__m365__verify-login') {
        verifyCalls += 1
        if (verifyCalls >= 2) return successResult(JSON.stringify({ success: true }))
        return successResult(JSON.stringify({ success: false }))
      }
      return originalExecute(exec)
    }
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await engine.begin('m365')
    await poll(async () => (await viewOf(ctx, 'm365')).state === 'connected', 'settle')
    expect(verifyCalls).toBeGreaterThanOrEqual(2)
    expect(manager.removed).not.toContain('m365')
  })

  it('tears down and records the failure when the verify poll times out', async () => {
    const { ctx, engine, tools, manager } = await boot({ flowTimeoutMs: 1000, pollIntervalMs: 100 })
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message: 'open the page https://login.microsoft.com/device and enter the code ABC-123 to authenticate' })))
    tools.results.set('mcp__m365__verify-login', successResult(JSON.stringify({ success: false })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await engine.begin('m365')
    await poll(async () => (await viewOf(ctx, 'm365')).state === 'error', 'timeout')
    const view = await viewOf(ctx, 'm365')
    expect(view.lastError).toBe('the device sign-in window closed before it completed')
    expect(manager.removed).toContain('m365')
  })

  it('cancels an in-flight flow without recording an error', async () => {
    const { ctx, engine, tools, manager } = await boot({ pollIntervalMs: 100 })
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message: 'open the page https://login.microsoft.com/device and enter the code ABC-123 to authenticate' })))
    tools.results.set('mcp__m365__verify-login', successResult(JSON.stringify({ success: false })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await engine.begin('m365')
    expect((await viewOf(ctx, 'm365')).state).toBe('authorizing')
    engine.cancel('m365')
    expect(manager.removed).toContain('m365')
    const view = await viewOf(ctx, 'm365')
    expect(view.state).toBe('unconfigured')
    expect(view.lastError).toBeUndefined()
  })

  it('fails the flow when the verify tool throws', async () => {
    const { ctx, engine, tools, manager } = await boot({ pollIntervalMs: 100 })
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message: 'open the page https://login.microsoft.com/device and enter the code ABC-123 to authenticate' })))
    tools.results.set('mcp__m365__verify-login', failureResult('verify failed'))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await engine.begin('m365')
    await poll(async () => (await viewOf(ctx, 'm365')).state === 'error', 'verify failure')
    const view = await viewOf(ctx, 'm365')
    expect(view.lastError).toBe('the verify tool reported an error')
  })

  it('drains in-flight flows on disposal: the server unmounts when the fiber settles', async () => {
    const { engine, tools, manager } = await boot({ pollIntervalMs: 100 })
    tools.results.set('mcp__m365__login', successResult(JSON.stringify({ error: 'device_code_required', message: 'open the page https://login.microsoft.com/device and enter the code ABC-123 to authenticate' })))
    tools.results.set('mcp__m365__verify-login', successResult(JSON.stringify({ success: false })))
    await manager.add({ serverName: 'm365', transport: 'stdio', command: 'npx', args: [] })
    await engine.begin('m365')
    expect(manager.removed).not.toContain('m365')
    // Dispose the fibers manually so the drain runs before the assertion.
    while (fibers.length > 0) {
      const fiber = fibers.pop()!
      await fiber.dispose()
    }
    expect(manager.removed).toContain('m365')
  })
})
