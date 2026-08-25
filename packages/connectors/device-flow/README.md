# dsh-connectors-device-flow

English | [中文](README.zh.md)

The connector device-code flow engine (`ctx.deviceFlow`): the host-side half of a `device` auth method on a [dsh-connectors](../connectors/README.md) connector. `begin` drives the provider's server-side login tool on the connector's mounted MCP server; when the provider returns a device-code instruction (a sign-in URL and a one-time code), the engine polls the provider's server-side verify tool in the background until the sign-in settles or the window closes. A provider that reports the account already signed in settles without a code. The engine never stores a credential: the MCP server owns its token cache.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `flowTimeoutMs` | number | `900000` | How long one flow waits for the sign-in before giving up (15 minutes). |
| `pollIntervalMs` | number | `5000` | How often the verify tool is polled. |

## Lifecycle

`begin(id)` is idempotent per connector: a second begin while one flow is in flight throws. The connectors service mounts the connector's servers before calling `begin`; a failed begin unmounts the servers and records the failure. The flow settles exactly once — verify success (the connector settles to `connected`, the servers stay mounted), verify error (the failure records and the servers unmount), window timeout (the failure records and the servers unmount), or cancel (no error, the servers unmount) — and the `authorizing` flag clears in the same step.

## Model Experience

None, as the engine is a host-side auth driver that registers no prompt, schema, or result of its own; the connected servers it enables are ordinary MCP tools owned by mcp-client.

#### KV Cache effect

No model-facing content enters any request; the only state it owns is the in-flight flow window, which the connector row's `authorizing` → `connected` transition keeps out of the prompt.

## Known Limitations and Deferred Work

- The login and verify tool names come from the manifest's `loginTool` and `verifyTool` fields; a provider that renames its tools needs a manifest change.
- The device-code parse expects the provider's message to carry a sign-in URL and a code; a provider that returns a different instruction format fails loudly rather than guessing.
- The verify poll is a fixed cadence; a provider with a longer poll interval wastes calls, but the sign-in still settles when the provider's cache warms.
