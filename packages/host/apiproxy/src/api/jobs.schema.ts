/**
 * jobs domain zod schemas: the branded job id, the wire view carried by
 * `session/jobs` frames, and the `jobs.log` request/response pair.
 */

import { z } from 'zod'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobLogView, JobView } from './jobs.ts'
import type { RequestPayload, ResponseValue } from './index.ts'
import type { Wire } from './rpc.schema.ts'

/** JobId: one brand cast after non-empty string validation. */
export const taskIdSchema = z.string().min(1) as unknown as z.ZodType<JobId>

/**
 * One wire task view. `kind` stays an open string because producer plugins
 * extend the registry's kind map by declaration merging, so the closed set is
 * not knowable at this boundary.
 */
export const taskViewSchema = z.object({
  id: taskIdSchema,
  kind: z.string().min(1),
  label: z.string().min(1),
  status: z.union([
    z.literal('running'),
    z.literal('stopping'),
    z.literal('completed'),
    z.literal('killed'),
    z.literal('failed'),
  ]),
  detail: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<Wire<JobView>>

/** jobs.log request payload. */
export const jobLogRequestSchema = z.object({
  sessionId: z.string(),
  jobId: taskIdSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'jobs.log'>>>

/** jobs.log response value. */
export const jobLogValueSchema = z.object({
  text: z.string(),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<JobLogView>> as unknown as z.ZodType<Wire<ResponseValue<'jobs.log'>>>
