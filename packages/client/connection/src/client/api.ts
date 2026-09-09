// Central contract re-export point: every contract import inside
// web-runtime goes through this single file.
// Types and runtime protocol helpers/bounds come from the apiproxy api/ layer
// (zero Node deps, browser-safe); AbstractApiClient is the client boundary.
// NEVER import the package root: it drags bootHost/cordis into the browser bundle.
// The ./api and ./client subpath exports are the browser-safe channels.

export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, PromptContentPart, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  ResponseValue, WorkspaceApi, WorkspaceId, WorkspaceView,
  SkillsApi, SkillEntry,
  FilesApi, FileEntry, FileRead,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  GoalsApi, GoalRef,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
  ConnectorAuthView, ConnectorConfigureFields, ConnectorServerView, ConnectorState, ConnectorView,
  McpApi, McpServerRow, McpServerSpec, McpServerStatus, McpStdioServerSpec, McpStreamableHttpServerSpec, McpToolRow,
  SubagentsApi, SubagentAddress, SubagentCatalog, SubagentListEntry, SubagentPromptReceipt,
  JobsApi, JobLogView, JobView,
} from '@open-harness/oh-host-apiproxy/api'
export type { ToolCallView, ToolResultView } from '@open-harness/oh-tools/presentation'
export type {
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
} from '@open-harness/oh-host-apiproxy/api'
// transportError lives in the apiproxy api layer (beside RpcResult, its
// subject); re-exported here so connection consumers keep one contract
// entry point.
export {
  JOB_LOG_WIRE_TAIL_BYTES,
  RpcId,
  SESSION_SEARCH_RESULT_LIMIT,
  transportError,
} from '@open-harness/oh-host-apiproxy/api'
export { AbstractApiClient } from '@open-harness/oh-host-apiproxy/client'
export type { IApiClient } from '@open-harness/oh-host-apiproxy/client'
export type { SessionId, SessionEvent } from '@open-harness/oh-session/types'
export type { MessageId } from '@open-harness/oh-llm/brand'
export type { ContentBlock, StreamChunk } from '@open-harness/oh-llm/types'

/** Successful value returned by the connection-generation host handshake. */
export type HostDescription = import('@open-harness/oh-host-apiproxy/api').ResponseValue<'host.describe'>

import type { RpcResponse, RpcResult } from '@open-harness/oh-host-apiproxy/api'

/**
 * Unwrap a unary response: RpcResponse<T> -> RpcResult<T> (business code only
 * cares about the result slot).
 * @param response - the unary response.
 * @returns its result slot.
 */
export function resultOf<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}
