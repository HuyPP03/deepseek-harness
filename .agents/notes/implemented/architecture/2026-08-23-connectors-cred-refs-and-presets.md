# Agent Note: Connectors P1 — credential references resolved by mcp-client, and the shipped preset roster

Status: implemented

English | [中文](2026-08-23-connectors-cred-refs-and-presets.zh.md)

## Problem

P0a resolved a connector's `{$cred}` slot to a literal at mount time and persisted that literal into the `.mcp` server document: every mounted server carried its secret on disk, a credential rotation required a reconnect, and the persisted document could not be shared or audited without exposing the value. The connector manifests' `presetId` fields pointed at presets that did not exist, so a connector session had no composition to start from.

## Decision

**Resolution moves into mcp-client, per connection attempt.** A server `env`/`headers` value is now `string | { $cred: REF }` (`ServerValue`), accepted by the mcp-client config schema. Before each attempt starts the transport, `resolveServerValues` resolves every reference: a stored `credentials` value for the reference wins; otherwise an `oauthTokens` bundle for the reference is presented as `Bearer <accessToken>`; otherwise the attempt fails with a named error naming the server and the reference. Both services are consumed through `ctx.get` — the optional-service pattern — and a literal-only config never touches them. Because resolution happens per attempt rather than per mount, a stored or refreshed value reaches the next attempt (including a supervisor reconnect) without a restart.

**The persisted document keeps the reference.** mcp-manager persists whatever spec it is given and passes references through untouched; the connectors service's `toManagerSpec` now resolves only `$override` slots (a boot-time snapshot of the user override document) and forwards `$cred` slots as references, after verifying a token method's slot names one of that method's declared refs (a slot referencing an undeclared ref fails the mount with `ConnectorCredentialMissingError`). `connect(id, 'token')` pre-checks every declared ref through `requireTokenRefsStored` before any mount, so a missing credential fails as a product error at the earliest point; boot-time mounts whose references are unset surface instead as mcp-client connection failures (reconnect backoff, state `down`) — the acceptable P1 semantics for a credential unset out from under a mounted server.

**Seven shipped presets.** `apps/cli/config/agent-presets/` gains `notion`, `github`, `google`, `slack`, `atlas`, `m365`, and `custom`, each `preset.yml` + `agent.cordis.yml` built on the `chat` composition (a working-directory-free assistant over the host-plane MCP tools) with a connector-specific persona. `custom` is the template `agentPresets.copy('custom', ...)` copies to a new preset id when a custom connector is added. A real-composition e2e (`apps/cli/tests/web-agent-presets.e2e.ts`) now asserts the full 12-preset roster and composes every connector preset through the booted Web composition, asserting the persona its file declares and the chat-style tool layer.

## Alternatives considered

**Resolve `{$cred}` in the connectors service and persist the reference only for its own servers.** Rejected: direct (non-connector) mcp-manager servers and hand-authored `.mcp` documents would still inline secrets, and two resolution sites (connectors at mount, nobody for direct servers) is a wider seam than one.

**Resolve at mount time and cache the value in the connection generation.** Rejected: the mcp-client supervisor restarts the original config on every attempt; re-reading the stores per attempt is the same cost (two store lookups) and is what makes a rotated or refreshed credential reach the next attempt for free.

**Give the connector presets their own tool composition.** Rejected: the connector's MCP servers mount host-wide and every preset already sees them; a working-directory-free assistant with a connector persona is the smallest correct session surface, and `custom` stays one template.

## Consequences

- `.mcp` server documents written by a connector now carry `{$cred: REF}` where P0a carried the literal; an old document with an inlined secret is simply a literal config (the schema accepts both), so no migration is needed.
- A `{$cred}` reference is re-resolved on every connection attempt: boot-time mounts with unset references fail into the reconnect loop (state `down`) instead of failing the product operation, so `connect`'s pre-check is the loud path for the user-facing case.
- The web preset e2e had been red since P0b added `client/ui-connectors` without building its client bundle: the booted Web composition loads that plugin from `lib/`. The bundle is built in-tree and the e2e asserts the new presets, so a future client-plugin addition that skips its build fails there.
- mcp-client now lists `dsh-credentials` and `dsh-credentials-oauth-tokens` as peer + dev dependencies (the connectors pattern).

## Related

- [Connectors — the host foundation](2026-08-23-connectors-host-foundation.md) — the state machine whose `{$cred}` interim behavior this note replaces.
- [Connectors — the chat-screen region](2026-08-23-connectors-chat-region.md) — the client surface P0b landed; this note's deferred P1 line is its first half (the `{$cred}` seam and the preset roster).

Deferred, in order: P2 Slack/Atlassian spikes, P3 oauth-flow engine with real `connector.complete`, P4 M365 device-code flow, P5 custom-connector UI.
