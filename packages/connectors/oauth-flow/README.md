# dsh-connectors-oauth-flow

English | [中文](README.zh.md)

The connector OAuth flow engine (`ctx.oauthFlow`): the host-side half of an `oauth` auth method on a [dsh-connectors](../connectors/README.md) connector. `begin` probes the provider MCP endpoint, follows its 401 challenge to the RFC 9728 protected-resource metadata and then to the RFC 8414 authorization-server metadata, registers a client (dynamic client registration, or the user's pre-registered app for `byoApp` methods), starts PKCE, and opens a loopback callback server. When the browser redirects back, the engine exchanges the code for a token bundle in the [`dsh-credentials-oauth-tokens`](../../credentials/oauth-tokens/README.md) store under the connector id, which the mcp-client credential seam presents as the bearer for the connector's servers. `ensureFresh` refreshes an expiring bundle before a mount, so a re-authorization only happens when the provider's grant actually lapsed.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `port` | number | `8766` | Loopback callback port (127.0.0.1 only). |
| `flowTimeoutMs` | number | `300000` | How long one flow waits for the browser redirect before giving up. |

## Lifecycle

`begin(id)` is idempotent per connector: a second begin while one flow is in flight throws. The flow settles exactly once — browser success (bundle stored, connector mounted), provider error, state mismatch, code exchange refusal, flow timeout, or cancellation — and the `authorizing` flag and the loopback listener clear in the same step. A failure that lands after the flow already settled is recorded on the connector as its `lastError` (state `error`).

## Model Experience

None, as the engine is a host-side auth driver that registers no prompt, schema, or result of its own; the connected servers it enables are ordinary MCP tools owned by mcp-client.

#### KV Cache effect

No model-facing content enters any request; the only state it owns is the stored token bundle, which the connector row's `authorizing` → `connected` transition keeps out of the prompt.

## Known Limitations and Deferred Work

- The engine re-runs discovery and client registration on every `begin`; a DCR client is not cached across flows, so a provider that caps registration volume would reject repeated authorizations. A `byoApp` client is read from the override document and the credentials seam, so it stays stable.
- The loopback port is single-instance per process; two flows for two connectors share the same port, and a flow that cannot bind its port fails loudly instead of picking a free one.
- The client surface opens the returned authorization URL in a new tab and polls the roster while a row is `authorizing`; a host without a browser (headless) still completes the flow, but nothing opens the URL automatically.
- Device-code auth (Microsoft 365) is not this engine's flow: its P4 lands a server-driven code exchange through the connector's own tools.
