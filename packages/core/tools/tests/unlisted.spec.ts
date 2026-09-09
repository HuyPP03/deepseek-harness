import { describe, expect, it } from 'vitest'
import { Context } from '@open-harness/cordis'
import SystemPrompt from '@open-harness/oh-system-prompt'
import ToolRuntime from '@open-harness/oh-tools'
import type { JsonValue, ToolDefinition } from '@open-harness/oh-tools'
import { CallId } from '@open-harness/oh-llm'
import type { ContentBlock } from '@open-harness/oh-llm'

/** One minimal registered tool; `unlisted` mirrors the MCP bridge's dispatch-only form. */
function tool(name: string, unlisted = false): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object' },
    ...(unlisted ? { unlisted: true } : {}),
    output: {
      schema: { type: 'object', properties: { content: { type: 'array', items: {} } }, required: ['content'], additionalProperties: false },
      render(_args: unknown, value: JsonValue): ContentBlock[] {
        return [{ type: 'text', text: String((value as { content: unknown[] }).content.length) }]
      },
    },
    async execute() {
      return { content: [] }
    },
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  return ctx
}

describe('ToolRuntime unlisted definitions', () => {
  it('keeps an unlisted tool out of schemas() while it stays gettable and dispatchable', async () => {
    const ctx = await mount()
    ctx.tools.register(tool('bash'))
    ctx.tools.register(tool('mcp__alpha__echo', true))

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['bash'])
    expect(ctx.tools.get('mcp__alpha__echo')).toBeDefined()

    const result = await ctx.tools.execute({
      callId: CallId('unlisted-test-1'),
      name: 'mcp__alpha__echo',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
  })

  it('still advertises every listed tool unchanged', async () => {
    const ctx = await mount()
    ctx.tools.register(tool('bash'))
    ctx.tools.register(tool('read'))
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['bash', 'read'])
  })
})
