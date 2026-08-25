/**
 * The model-facing MCP bridge: three small listed tools that give the model
 * on-demand access to the per-server MCP tools without their schemas ever
 * entering the request `tools` array.
 *
 * The mcp-client registers each MCP tool as an unlisted (dispatch-only)
 * definition; a server with a large tool surface (200+ tools, megabytes of
 * JSON Schema) would otherwise overflow the model's context window on every
 * turn. The model instead lists servers, describes one tool, and calls it —
 * the inner dispatch runs the registered per-tool definition through the full
 * ToolRuntime pipeline, so the session log still records the exact
 * `mcp__<server>__<tool>` call with its arguments and result.
 *
 * @module
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { McpServerView } from './types.ts'

/** The public-name prefix every MCP tool carries (see the mcp-client naming contract). */
const MCP_NAME_PREFIX = 'mcp__'

/** Settled outcome of one inner dispatch, as the bridge needs it. */
export interface BridgeDispatchResult {
  readonly isError: boolean
  /** The inner tool's canonical value; present only on success. */
  readonly value?: JsonValue
  /** Failure message when `isError` is true. */
  readonly message: string
  /** The inner tool's rendered content blocks. */
  readonly content: readonly ContentBlock[]
}

/** Registry-owned facts and operations the bridge tools read. */
export interface BridgeFaces {
  /** Snapshot of every reported server, sorted by serverName. */
  servers(): readonly McpServerView[]
  /** One registered tool's definition, or undefined when the name is not an unlisted MCP tool. */
  target(name: string): ToolDefinition | undefined
  /** Dispatch one registered tool through the ToolRuntime and resolve its outcome. */
  dispatch(name: string, args: Record<string, unknown>, exec: ToolRunContext): Promise<BridgeDispatchResult>
}

/** The three bridge tool definitions, ready for `ctx.tools.register`. */
export interface BridgeTools {
  readonly list: ToolDefinition
  readonly describe: ToolDefinition
  readonly call: ToolDefinition
}

/** The mcp-list server entry: one reported server with its public tool names. */
interface ListServerEntry {
  readonly server: string
  readonly tools: readonly { readonly name: string; readonly description: string }[]
}

/** The mcp-list canonical value. */
interface ListValue {
  readonly servers: readonly ListServerEntry[]
}

/** The mcp-describe canonical value: one tool's model-facing contract. */
interface DescribeValue {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

/** The mcp-call canonical value: the inner tool's canonical result. */
interface CallValue {
  readonly content: JsonValue[]
  readonly structuredContent?: JsonValue
}

/**
 * Narrow an arbitrary value to a string-keyed record without accepting arrays
 * or null. Used on tool arguments (untrusted model input) and result values.
 * @param value - the value to narrow.
 * @returns true for plain objects only.
 */
function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Project one mcp-call value into model-visible text: the text blocks joined,
 * every non-text block replaced by a placeholder (images are projected to
 * durable attachments by the inner mcp-client definition, not here).
 * @param value - the inner tool's canonical value.
 * @returns one text block.
 */
function callText(value: CallValue): ContentBlock[] {
  const lines: string[] = []
  for (const block of value.content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      lines.push(block.text)
    } else {
      lines.push(`[${isRecord(block) && typeof block.type === 'string' ? block.type : 'unsupported'} content]`)
    }
  }
  return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '(no model-visible content)' }]
}

/**
 * Build the three bridge definitions over one registry's faces.
 * @param faces - the registry-owned snapshot reader and dispatch operation.
 * @returns the `mcp_list`, `mcp_describe`, and `mcp_call` definitions.
 */
export function createBridgeTools(faces: BridgeFaces): BridgeTools {
  const list: ToolDefinition = {
    name: 'mcp_list',
    description:
      'List the MCP tools available from the connected MCP servers, as public tool names with one-line descriptions. ' +
      'To use a tool: call mcp_describe with its name to get the input schema, then mcp_call with arguments matching that schema. ' +
      'Pass `server` to limit the list to one server.',
    parameters: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Optional: limit the list to this server name.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          servers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                server: { type: 'string' },
                tools: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['name', 'description'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['server', 'tools'],
              additionalProperties: false,
            },
          },
        },
        required: ['servers'],
        additionalProperties: false,
      } as Record<string, unknown>,
      render(_args: unknown, value: JsonValue) {
        const view = value as unknown as ListValue
        const text = view.servers.map(entry =>
          `${entry.server} (${entry.tools.length} tools):\n${entry.tools
            .map(tool => `  - ${tool.name}: ${tool.description}`)
            .join('\n')}`,
        ).join('\n')
        return [{ type: 'text', text: text.length > 0 ? text : 'No MCP servers are connected.' }]
      },
    },
    async execute(args: unknown, _exec: ToolRunContext): Promise<unknown> {
      const server = isRecord(args) && typeof args.server === 'string' ? args.server : undefined
      const servers: ListServerEntry[] = faces.servers()
        .filter(view => server === undefined || view.serverName === server)
        .map(view => ({
          server: view.serverName,
          tools: view.tools.map(tool => ({ name: tool.name, description: tool.description })),
        }))
      if (server !== undefined && servers.length === 0) {
        throw new Error(
          `unknown MCP server "${server}": the connected servers are ${faces.servers().map(view => view.serverName).join(', ') || '(none)'}`,
        )
      }
      return { servers } satisfies ListValue
    },
  }

  const describe: ToolDefinition = {
    name: 'mcp_describe',
    description:
      'Show one MCP tool: its description and its input schema, by the public tool name returned by mcp_list. ' +
      'Use the returned schema to build the arguments for mcp_call.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The public tool name from mcp_list (mcp__<server>__<tool>).',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object' },
        },
        required: ['name', 'description', 'parameters'],
        additionalProperties: false,
      } as Record<string, unknown>,
      render(_args: unknown, value: JsonValue) {
        const view = value as unknown as DescribeValue
        return [{
          type: 'text',
          text: `${view.name}\n${view.description}\nInput schema:\n${JSON.stringify(view.parameters, undefined, 2)}`,
        }]
      },
    },
    async execute(args: unknown, _exec: ToolRunContext): Promise<unknown> {
      const name = isRecord(args) && typeof args.name === 'string' ? args.name : undefined
      if (name === undefined) throw new Error('mcp_describe: `name` is required')
      const definition = faces.target(name)
      if (definition === undefined) {
        throw new Error(`unknown tool "${name}": use mcp_list to see the registered MCP tools`)
      }
      return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      } satisfies DescribeValue
    },
  }

  const call: ToolDefinition = {
    name: 'mcp_call',
    description:
      'Call one MCP tool by its public tool name with arguments matching the schema from mcp_describe. ' +
      'Returns the tool result content.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The public tool name from mcp_list (mcp__<server>__<tool>).',
        },
        args: {
          type: 'object',
          description: 'The tool arguments, matching the schema from mcp_describe.',
        },
      },
      required: ['name', 'args'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          content: { type: 'array', items: {} },
          structuredContent: {},
        },
        required: ['content'],
        additionalProperties: false,
      } as Record<string, unknown>,
      render(_args: unknown, value: JsonValue): ContentBlock[] {
        return callText(value as unknown as CallValue)
      },
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const name = isRecord(args) && typeof args.name === 'string' ? args.name : undefined
      const toolArgs = isRecord(args) && isRecord(args.args) ? args.args : undefined
      if (name === undefined) throw new Error('mcp_call: `name` is required')
      if (toolArgs === undefined) throw new Error('mcp_call: `args` must be an object')
      if (!name.startsWith(MCP_NAME_PREFIX)) {
        throw new Error(`"${name}" is not an MCP tool name (expected the mcp__ prefix from mcp_list)`)
      }
      const result = await faces.dispatch(name, toolArgs, exec)
      if (result.isError) {
        throw new Error(`${name} failed: ${result.message}`)
      }
      const value = result.value
      if (!isRecord(value) || !Array.isArray(value.content)) {
        throw new Error(`${name} returned no model-visible content`)
      }
      return value as unknown as CallValue
    },
  }

  return { list, describe, call }
}
