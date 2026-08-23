/**
 * connector domain zod schemas (names derived from map keys:
 * connectorListRequestSchema / connectorListViewSchema / …). The views
 * mirror the service's wire-safe ConnectorView: no server command, URL,
 * header, or credential field crosses the wire; the only secret direction
 * is the token value inside connector.configure and connector.complete.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { credentialRefNameSchema } from './credentials.schema.ts'
import type {
  AddCustomSpec,
  ConnectorAuthView,
  ConnectorConfigureFields,
  ConnectorServerView,
  ConnectorView,
} from '@deepseek-ai/dsh-connectors'

/** ConnectorView.servers entry: the live state of one declared server. */
export const connectorServerViewSchema = z.object({
  serverName: z.string(),
  mounted: z.boolean(),
  status: z.enum(['connecting', 'connected', 'reconnecting', 'down']).optional(),
}) satisfies z.ZodType<Wire<ConnectorServerView>>

/** ConnectorView.auth entry: one supported auth method, configured state only. */
export const connectorAuthViewSchema = z.object({
  mode: z.enum(['token', 'oauth', 'device']),
  configured: z.boolean(),
  howTo: z.string().optional(),
  setupGuide: z.array(z.string()).optional(),
  reauthHint: z.string().optional(),
}) satisfies z.ZodType<Wire<ConnectorAuthView>>

/** One connector's wire-safe view. */
export const connectorViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  presetId: z.string(),
  state: z.enum(['unconfigured', 'needs-auth', 'authorizing', 'connecting', 'connected', 'reconnecting', 'down', 'error']),
  lastError: z.string().optional(),
  custom: z.boolean(),
  servers: z.array(connectorServerViewSchema),
  auth: z.array(connectorAuthViewSchema),
  suggestions: z.array(z.string()),
  products: z.array(z.string()).optional(),
}) satisfies z.ZodType<Wire<ConnectorView>>

/** connector.list request payload. */
export const connectorListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'connector.list'>>>

/** connector.list response value. */
export const connectorListViewSchema = z.object({
  connectors: z.array(connectorViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'connector.list'>>>

/** The fields one configure/complete call can set; absent fields are left untouched. */
const connectorConfigureFieldsSchema = z.object({
  token: z.string().min(1).optional(),
  credentials: z.record(credentialRefNameSchema, z.string().min(1)).optional(),
  url: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  products: z.array(z.string().min(1)).optional(),
  orgMode: z.boolean().optional(),
  readOnly: z.boolean().optional(),
}) satisfies z.ZodType<Wire<ConnectorConfigureFields>>

/** connector.configure request payload: the fields to store. */
export const connectorConfigureRequestSchema = z.object({
  id: z.string().min(1),
  fields: connectorConfigureFieldsSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'connector.configure'>>>

/** connector.configure response value: the updated view. */
export const connectorConfigureValueSchema = z.object({
  connector: connectorViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'connector.configure'>>>

/** connector.connect request payload: the auth mode to mount through. */
export const connectorConnectRequestSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['token', 'oauth', 'device']),
}) satisfies z.ZodType<Wire<RequestPayload<'connector.connect'>>>

/** connector.connect response value: the updated view. */
export const connectorConnectValueSchema = z.object({
  connector: connectorViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'connector.connect'>>>

/** connector.complete request payload: the auth flow's resulting token. */
export const connectorCompleteRequestSchema = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'connector.complete'>>>

/** connector.complete response value: the updated view. */
export const connectorCompleteValueSchema = z.object({
  connector: connectorViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'connector.complete'>>>

/** connector.disconnect request payload. */
export const connectorDisconnectRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'connector.disconnect'>>>

/** connector.disconnect response value: the updated view. */
export const connectorDisconnectValueSchema = z.object({
  connector: connectorViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'connector.disconnect'>>>

/** One user-authored custom connector as added through connector.add. */
const addCustomSpecSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  transport: z.enum(['stdio', 'streamable-http']),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(credentialRefNameSchema, z.string()).optional(),
  url: z.string().min(1).optional(),
  headers: z.record(z.string().min(1), z.string()).optional(),
  tokenVar: z.string().min(1).optional(),
  tokenVarIsHeader: z.boolean().optional(),
}) satisfies z.ZodType<Wire<AddCustomSpec>>

/** connector.add request payload. */
export const connectorAddRequestSchema = z.object({
  spec: addCustomSpecSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'connector.add'>>>

/** connector.add response value: the new connector id. */
export const connectorAddValueSchema = z.object({
  id: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'connector.add'>>>

/** connector.remove request payload. */
export const connectorRemoveRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'connector.remove'>>>

/** connector.remove response value. */
export const connectorRemoveValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'connector.remove'>>>
