/**
 * mcp domain zod schemas (names derived from map keys:
 * mcpListRequestSchema / mcpListValueSchema, mcpAddRequestSchema / mcpAddValueSchema, …).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { McpServerRow, McpToolRow } from './mcp.ts'

/** McpToolRow row of mcp.list. */
export const mcpToolRowSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
}) satisfies z.ZodType<Wire<McpToolRow>>

/** McpServerRow row of mcp.list. */
export const mcpServerRowSchema = z.object({
  serverName: z.string().min(1),
  status: z.union([z.literal('connecting'), z.literal('connected'), z.literal('reconnecting'), z.literal('down')]),
  managed: z.boolean(),
  tools: z.array(mcpToolRowSchema),
}) satisfies z.ZodType<Wire<McpServerRow>>

/** mcp.list request payload. */
export const mcpListRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.list'>>>

/** mcp.list response value. */
export const mcpListValueSchema = z.object({
  servers: z.array(mcpServerRowSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.list'>>>

/** StdioServerSpec branch of the mcp.add payload. */
const mcpStdioSpecSchema = z.object({
  serverName: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  toolCallTimeoutMs: z.number().int().positive().optional(),
})

/** StreamableHttpServerSpec branch of the mcp.add payload. */
const mcpStreamableHttpSpecSchema = z.object({
  serverName: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  transport: z.literal('streamable-http'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  toolCallTimeoutMs: z.number().int().positive().optional(),
})

/** mcp.add request payload: one user server spec (stdio or streamable-http). */
export const mcpAddRequestSchema = z.object({
  spec: z.union([mcpStdioSpecSchema, mcpStreamableHttpSpecSchema]),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.add'>>>

/** mcp.add response value. */
export const mcpAddValueSchema = z.object({
  serverName: z.string().min(1),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.add'>>>

/** mcp.remove request payload. */
export const mcpRemoveRequestSchema = z.object({
  serverName: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.remove'>>>

/** mcp.remove response value. */
export const mcpRemoveValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.remove'>>>

/** mcp.reconnect request payload. */
export const mcpReconnectRequestSchema = z.object({
  serverName: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.reconnect'>>>

/** mcp.reconnect response value. */
export const mcpReconnectValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.reconnect'>>>
