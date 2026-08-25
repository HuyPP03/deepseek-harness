import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import McpRegistry from '@deepseek-ai/dsh-mcp-registry'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-registry'

/** One minimal registered tool; `unlisted` mirrors the mcp-client per-tool form. */
function tool(name: string, description: string, parameters: Record<string, unknown>, execute: ToolDefinition['execute'], unlisted = false): ToolDefinition {
  return {
    name,
    description,
    parameters,
    ...(unlisted ? { unlisted: true } : {}),
    output: {
      schema: { type: 'object', properties: { content: { type: 'array', items: {} } }, required: ['content'], additionalProperties: false },
      render(_args: unknown, value: JsonValue): ContentBlock[] {
        const content = (value as unknown as { content: readonly { type: string; text?: string }[] }).content
        return [{ type: 'text', text: content.map(block => block.text ?? '').join('\n') }]
      },
    },
    execute,
  }
}

function serverView(serverName: string, toolCount: number): McpServerView {
  return {
    serverName,
    status: 'connected',
    tools: Array.from({ length: toolCount }, (_, index) => ({
      name: `mcp__${serverName}__tool-${index}`,
      description: `tool ${index}`,
    })),
  }
}

async function mount(): Promise<{ ctx: Context; disposeRegistry: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(McpRegistry)
  return { ctx, disposeRegistry: () => fiber.dispose() }
}

/** Run one bridge tool at the global scope and project the settled outcome. */
async function run(ctx: Context, name: string, arguments_: unknown): Promise<{ isError: boolean; value?: unknown; message?: string }> {
  const result = await ctx.tools.execute({
    callId: CallId(`bridge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    name,
    arguments: arguments_,
    signal: new AbortController().signal,
  })
  return result.isError
    ? { isError: true, message: result.error.message }
    : { isError: false, value: result.value }
}

describe('McpRegistry bridge', () => {
  it('mcp_list reports every server; the server filter narrows and rejects unknown names', async () => {
    const { ctx } = await mount()
    ctx.mcpRegistry.report('alpha', { read: () => serverView('alpha', 2) })
    ctx.mcpRegistry.report('beta', { read: () => serverView('beta', 1) })

    const all = await run(ctx, 'mcp_list', {})
    expect(all.isError).toBe(false)
    expect(all.value).toEqual({
      servers: [
        { server: 'alpha', tools: [{ name: 'mcp__alpha__tool-0', description: 'tool 0' }, { name: 'mcp__alpha__tool-1', description: 'tool 1' }] },
        { server: 'beta', tools: [{ name: 'mcp__beta__tool-0', description: 'tool 0' }] },
      ],
    })

    const filtered = await run(ctx, 'mcp_list', { server: 'beta' })
    expect(filtered.isError).toBe(false)
    expect((filtered.value as { servers: unknown[] }).servers).toHaveLength(1)

    const unknown = await run(ctx, 'mcp_list', { server: 'gamma' })
    expect(unknown.isError).toBe(true)
    expect(unknown.message).toBe('unknown MCP server "gamma": the connected servers are alpha, beta')

    // A non-string `server` is treated as absent, not an error.
    const loose = await run(ctx, 'mcp_list', { server: 7 })
    expect(loose.isError).toBe(false)
  })

  it('mcp_describe returns one registered MCP tool and rejects unknown, listed, and missing names', async () => {
    const { ctx } = await mount()
    const echo = tool('mcp__alpha__echo', 'echoes the message', { type: 'object', properties: { msg: { type: 'string' } } }, async () => ({ content: [] }), true)
    const listed = tool('bash', 'runs a command', { type: 'object' }, async () => ({ content: [] }))
    ctx.tools.register(echo)
    ctx.tools.register(listed)

    const known = await run(ctx, 'mcp_describe', { name: 'mcp__alpha__echo' })
    expect(known.isError).toBe(false)
    expect(known.value).toEqual({
      name: 'mcp__alpha__echo',
      description: 'echoes the message',
      parameters: { type: 'object', properties: { msg: { type: 'string' } } },
    })

    const unknown = await run(ctx, 'mcp_describe', { name: 'mcp__alpha__ghost' })
    expect(unknown.isError).toBe(true)
    expect(unknown.message).toBe('unknown tool "mcp__alpha__ghost": use mcp_list to see the registered MCP tools')

    // A listed (non-unlisted) tool is not a bridge target.
    const listedName = await run(ctx, 'mcp_describe', { name: 'bash' })
    expect(listedName.isError).toBe(true)
    expect(listedName.message).toBe('unknown tool "bash": use mcp_list to see the registered MCP tools')

    const missing = await run(ctx, 'mcp_describe', {})
    expect(missing.isError).toBe(true)
    expect(missing.message).toBe('mcp_describe: `name` is required')
  })

  it('mcp_call dispatches an unlisted MCP tool through the runtime and returns its value', async () => {
    const { ctx } = await mount()
    const calls: unknown[] = []
    const echo = tool('mcp__alpha__echo', 'echoes', { type: 'object' }, async (args: unknown) => {
      calls.push(args)
      return { content: [{ type: 'text', text: 'hello' }] }
    }, true)
    ctx.tools.register(echo)

    const result = await run(ctx, 'mcp_call', { name: 'mcp__alpha__echo', args: { msg: 'hi' } })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ content: [{ type: 'text', text: 'hello' }] })
    expect(calls).toEqual([{ msg: 'hi' }])
  })

  it('mcp_call surfaces an inner failure and rejects malformed or non-MCP targets', async () => {
    const { ctx } = await mount()
    ctx.tools.register(tool('mcp__alpha__boom', 'fails', { type: 'object' }, async () => { throw new Error('boom') }, true))

    const failed = await run(ctx, 'mcp_call', { name: 'mcp__alpha__boom', args: {} })
    expect(failed.isError).toBe(true)
    expect(failed.message).toBe('mcp__alpha__boom failed: boom')

    const missing = await run(ctx, 'mcp_call', { args: {} })
    expect(missing.message).toBe('mcp_call: `name` is required')
    const badArgs = await run(ctx, 'mcp_call', { name: 'mcp__alpha__boom', args: 'nope' })
    expect(badArgs.message).toBe('mcp_call: `args` must be an object')
    const notMcp = await run(ctx, 'mcp_call', { name: 'bash', args: {} })
    expect(notMcp.message).toBe('"bash" is not an MCP tool name (expected the mcp__ prefix from mcp_list)')
    // The mcp__ prefix alone does not admit an unregistered name.
    const ghost = await run(ctx, 'mcp_call', { name: 'mcp__alpha__ghost', args: {} })
    expect(ghost.isError).toBe(true)
    expect(ghost.message).toContain('mcp__alpha__ghost failed:')
  })

  it('mcp_call rejects an unlisted target without the mcp__ prefix', async () => {
    const { ctx } = await mount()
    ctx.tools.register(tool('shadow', 'unlisted but not an MCP name', { type: 'object' }, async () => ({ content: [] }), true))
    const result = await run(ctx, 'mcp_call', { name: 'shadow', args: {} })
    expect(result.isError).toBe(true)
    expect(result.message).toBe('"shadow" is not an MCP tool name (expected the mcp__ prefix from mcp_list)')
  })

  it('mcp_list names the missing-server list "(none)" when no server is connected', async () => {
    const { ctx } = await mount()
    const unknown = await run(ctx, 'mcp_list', { server: 'gamma' })
    expect(unknown.isError).toBe(true)
    expect(unknown.message).toBe('unknown MCP server "gamma": the connected servers are (none)')
  })

  it('mcp_call rejects an inner success whose value carries no content array', async () => {
    const { ctx } = await mount()
    // An unlisted tool with a permissive output shape can settle successfully
    // without the MCP result vocabulary; the bridge guard names that.
    ctx.tools.register({
      name: 'mcp__alpha__odd',
      description: 'odd shape',
      parameters: { type: 'object' },
      unlisted: true,
      output: {
        schema: { type: 'object', properties: { foo: { type: 'number' } }, required: ['foo'], additionalProperties: false },
        render(_args: unknown, _value: JsonValue): ContentBlock[] {
          return [{ type: 'text', text: 'odd' }]
        },
      },
      async execute() {
        return { foo: 1 }
      },
    })
    const failed = await run(ctx, 'mcp_call', { name: 'mcp__alpha__odd', args: {} })
    expect(failed.isError).toBe(true)
    expect(failed.message).toBe('mcp__alpha__odd returned no model-visible content')
  })

  it('mcp_call forwards the calling agent to the inner dispatch', async () => {
    const { ctx } = await mount()
    const seen: { agent?: unknown }[] = []
    ctx.tools.register({
      name: 'mcp__alpha__who',
      description: 'reports its agent',
      parameters: { type: 'object' },
      unlisted: true,
      output: {
        schema: { type: 'object', properties: { content: { type: 'array', items: {} } }, required: ['content'], additionalProperties: false },
        render(_args: unknown, _value: JsonValue): ContentBlock[] {
          return [{ type: 'text', text: 'who' }]
        },
      },
      async execute(_args: unknown, exec: { agent?: unknown }) {
        seen.push({ agent: exec.agent })
        return { content: [] }
      },
    })
    const agent = { id: 'agent-bridge-test' } as never
    const result = await ctx.tools.execute({
      callId: CallId('bridge-agent-test'),
      name: 'mcp_call',
      arguments: { name: 'mcp__alpha__who', args: {} },
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(seen).toEqual([{ agent }])
  })

  it('renders a non-string-typed content block as an unsupported placeholder', async () => {
    const { ctx } = await mount()
    const call = ctx.tools.get('mcp_call')!
    const rendered = call.output.render({}, {
      content: [{ type: 7 }, { type: 'text', text: 'ok' }],
    })
    expect(rendered).toEqual([{ type: 'text', text: '[unsupported content]\nok' }])
  })

  it('registers the three listed bridge tools and removes them with the fiber', async () => {
    const { ctx, disposeRegistry } = await mount()
    const names = ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names).toEqual(['mcp_call', 'mcp_describe', 'mcp_list'])

    await disposeRegistry()
    expect(ctx.tools.get('mcp_list')).toBeUndefined()
    expect(ctx.tools.get('mcp_describe')).toBeUndefined()
    expect(ctx.tools.get('mcp_call')).toBeUndefined()
  })

  it('renders the bridge results to model-visible text', async () => {
    const { ctx } = await mount()
    const list = ctx.tools.get('mcp_list')!
    const listed = list.output.render({}, {
      servers: [{ server: 'alpha', tools: [{ name: 'mcp__alpha__a', description: 'A' }] }],
    })
    expect(listed).toEqual([{ type: 'text', text: 'alpha (1 tools):\n  - mcp__alpha__a: A' }])
    expect(list.output.render({}, { servers: [] })).toEqual([{ type: 'text', text: 'No MCP servers are connected.' }])

    const describe = ctx.tools.get('mcp_describe')!
    const described = describe.output.render({}, { name: 'n', description: 'd', parameters: { type: 'object' } })
    expect(described).toEqual([{ type: 'text', text: 'n\nd\nInput schema:\n{\n  "type": "object"\n}' }])

    const call = ctx.tools.get('mcp_call')!
    const called = call.output.render({}, {
      content: [
        { type: 'text', text: 'one' },
        { type: 'image', mimeType: 'image/png', data: 'x' },
        { type: 'text', text: 'two' },
      ],
    })
    expect(called).toEqual([{ type: 'text', text: 'one\n[image content]\ntwo' }])
    expect(call.output.render({}, { content: [] })).toEqual([{ type: 'text', text: '(no model-visible content)' }])
  })
})
