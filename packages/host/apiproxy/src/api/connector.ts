/**
 * connector domain contract: the web face of the predefined external
 * connection subsystem (`ctx.connectors`).
 *
 * `list` is structurally secret-free — a connector view carries no server
 * command, URL, header, or credential field — and is the chat screen's
 * connector roster. The management calls are privileged and
 * loopback-pinned: `configure` and `complete` store a credential value
 * (the one direction a secret crosses this wire) and may mount external
 * servers, `connect` and `disconnect` drive the live MCP mounts, and
 * `add` and `remove` author or delete a user custom connector whose
 * command or endpoint the user supplies.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { AddCustomSpec, ConnectorConfigureFields, ConnectorView } from '@deepseek-ai/dsh-connectors'

/** Connector-domain unary methods (the map keys connector.* of RpcMethodMap). */
export interface ConnectorApi {
  /**
   * Every catalog and custom connector as a secret-free view, sorted by id.
   * A deployment without the connectors service answers with an empty
   * roster: composing no connector is a valid deployment, and the surface
   * simply shows none.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ connectors: readonly ConnectorView[] }>>

  /**
   * Store the named fields (a token value, the client id/secret pair, the
   * endpoint, or the provider switches) and, for a token method that is
   * fully configured for the first time, mount the connector's servers.
   * The response carries the updated view.
   */
  configure(request: RpcRequest<{ id: string; fields: ConnectorConfigureFields }>): Promise<RpcResponse<{ connector: ConnectorView }>>

  /**
   * Mount the named connector's servers through one auth mode. `token`
   * resolves the stored credentials now; `oauth` and `device` reject with
   * `connector-auth-unavailable` while the flow engine is not composed.
   */
  connect(request: RpcRequest<{ id: string; mode: 'token' | 'oauth' | 'device' }>): Promise<RpcResponse<{ connector: ConnectorView }>>

  /**
   * Settle one connector's auth with the resulting token: the store-and-
   * connect half of an auth flow. While no flow engine is composed this is
   * the same operation as `configure` with `{ token }`.
   */
  complete(request: RpcRequest<{ id: string; token: string }>): Promise<RpcResponse<{ connector: ConnectorView }>>

  /**
   * Begin one connector's browser OAuth flow: the engine returns the URL
   * the client opens and the flow expiry. The exchange completes
   * server-side when the provider redirects to the loopback callback;
   * the connector view transitions to `authorizing` while in flight.
   */
  authorize(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ authorizationUrl: string; expiresAt: number }>>

  /**
   * Begin one connector's device-code flow: the engine drives the provider's
   * login tool and returns the sign-in facts the user completes in a
   * browser. The verify poll runs server-side; the connector view
   * transitions to `authorizing` while in flight and `connected` when the
   * sign-in settles.
   */
  deviceLogin(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{
    status: 'device-code' | 'ready'
    verificationUri?: string
    userCode?: string
    message?: string
    expiresAt: number
  }>>

  /**
   * Unmount the connector's servers, remove its stored credentials and
   * token bundle, and delete its override document; the view returns to
   * `unconfigured`.
   */
  disconnect(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ connector: ConnectorView }>>

  /**
   * Author one user custom connector (persist the manifest and copy the
   * `custom` preset); a custom without auth auto-mounts at add.
   * @returns the new connector id.
   */
  add(request: RpcRequest<{ spec: AddCustomSpec }>): Promise<RpcResponse<{ id: string }>>

  /**
   * Remove one user custom connector (preset copy, manifest, servers,
   * stored credentials). Shipped connectors refuse with
   * `connector-not-custom`.
   */
  remove(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{}>>
}
