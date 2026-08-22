/**
 * files domain zod schemas (names derived from map keys: fileListRequestSchema /
 * fileListValueSchema / fileReadRequestSchema / fileReadValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { FileEntry } from './files.ts'

/** FileEntry row of files.list. */
export const fileEntrySchema = z.object({
  path: z.string().min(1),
  relative: z.string().min(1),
  root: z.string().min(1),
  isDirectory: z.boolean(),
}) satisfies z.ZodType<Wire<FileEntry>>

/** files.list request payload. */
export const fileListRequestSchema = z.object({
  sessionId: sessionIdSchema,
  query: z.string().min(0).max(200).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'files.list'>>>

/** files.list response value. */
export const fileListValueSchema = z.object({
  files: z.array(fileEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'files.list'>>>

/** files.read request payload (the path is a list row's canonical path). */
export const fileReadRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: z.string().min(1).max(4096),
}) satisfies z.ZodType<Wire<RequestPayload<'files.read'>>>

/** files.read response value. */
export const fileReadValueSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  lines: z.number().int().min(0),
  truncated: z.boolean(),
  binary: z.boolean(),
  size: z.number().int().min(0),
}) satisfies z.ZodType<Wire<ResponseValue<'files.read'>>>
