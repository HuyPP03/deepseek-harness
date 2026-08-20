import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-registry'

/** Build one connected server view with `toolCount` placeholder tools. */
function view(serverName: string, toolCount = 0): McpServerView {
  return {
    serverName,
    status: 'connected',
    tools: Array.from({ length: toolCount }, (_, index) => ({
      name: `mcp__${serverName}__tool-${index}`,
      description: `tool ${index}`,
    })),
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(McpRegistry)
  return ctx
}

describe('McpRegistry', () => {
  it('lists nothing before any reporter', async () => {
    const ctx = await mount()
    expect(ctx.mcpRegistry.servers()).toEqual([])
  })

  it('pulls each reporter reader at read time and follows its state changes', async () => {
    const ctx = await mount()
    let state: McpServerView | undefined = view('github', 2)
    const dispose = ctx.mcpRegistry.report('github', () => state)

    expect(ctx.mcpRegistry.servers()).toEqual([view('github', 2)])

    state = { ...view('github', 2), status: 'reconnecting', tools: [] }
    expect(ctx.mcpRegistry.servers()).toEqual([state])

    dispose()
    expect(ctx.mcpRegistry.servers()).toEqual([])
  })

  it('omits reporters whose reader yields nothing', async () => {
    const ctx = await mount()
    const kept = ctx.mcpRegistry.report('web', () => view('web', 1))
    const absent = ctx.mcpRegistry.report('github', () => undefined)

    expect(ctx.mcpRegistry.servers()).toEqual([view('web', 1)])

    absent()
    kept()
    expect(ctx.mcpRegistry.servers()).toEqual([])
  })

  it('sorts the snapshot by serverName, independent of report order', async () => {
    const ctx = await mount()
    ctx.mcpRegistry.report('web', () => view('web'))
    ctx.mcpRegistry.report('alpha', () => view('alpha'))
    ctx.mcpRegistry.report('github', () => view('github'))

    expect(ctx.mcpRegistry.servers().map(server => server.serverName)).toEqual(['alpha', 'github', 'web'])
  })

  it('rejects a duplicate serverName and leaves the first reporter intact', async () => {
    const ctx = await mount()
    const first = view('github', 1)
    const disposeFirst = ctx.mcpRegistry.report('github', () => first)

    expect(() => ctx.mcpRegistry.report('github', () => view('github', 2))).toThrow(
      'mcpRegistry: server "github" is already reported',
    )
    expect(ctx.mcpRegistry.servers()).toEqual([first])

    disposeFirst()
    expect(ctx.mcpRegistry.servers()).toEqual([])
  })

  it('makes the reporter disposer idempotent and frees the namespace', async () => {
    const ctx = await mount()
    const dispose = ctx.mcpRegistry.report('github', () => view('github', 1))

    dispose()
    dispose()
    expect(ctx.mcpRegistry.servers()).toEqual([])

    const second = view('github', 3)
    ctx.mcpRegistry.report('github', () => second)
    expect(ctx.mcpRegistry.servers()).toEqual([second])
  })

  it('unregisters the service with its owning fiber (HMR reload path)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(McpRegistry)
    const dispose = ctx.mcpRegistry.report('github', () => view('github', 1))
    expect(ctx.mcpRegistry.servers()).toHaveLength(1)

    await fiber.dispose()
    dispose()
  })
})
