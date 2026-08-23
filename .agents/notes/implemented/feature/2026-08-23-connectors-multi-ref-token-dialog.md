# Agent Note: Connectors P2 — the Slack/Atlassian spikes and the per-reference token dialog

Status: implemented

English | [中文](2026-08-23-connectors-multi-ref-token-dialog.zh.md)

## Problem

P1's token dialog typed one secret and stored it under the token method's first credential reference. Live probes of the two hardest shipped integrations showed that is not enough: the Slack server requires two values (bot token **and** workspace Team ID), so the dialog had nowhere to put the second, and the shipped Atlassian manifest carried no bearer at all for the remote OAuth server it declares.

## Findings (live probes)

**Slack.** `npx -y @modelcontextprotocol/server-slack` (2025.4.25, npm-flagged deprecated — the reference servers moved to `modelcontextprotocol/servers-archived`) refuses to start without both `SLACK_BOT_TOKEN` and `SLACK_TEAM_ID`, and it completes MCP `initialize`/`tools/list` (8 tools) even with an invalid token: Slack API calls fail at call time, so an invalid token reads as a `connected` server. The manifest now declares both references; the archive status and the no-auth-at-startup behavior are recorded as known limitations rather than worked around.

**Atlassian.** The endpoint at `https://mcp.atlassian.com/v1/mcp/authv2` answers unauthenticated calls with `401` plus RFC 9728 `WWW-Authenticate: Bearer resource_metadata=…`. The discovery chain is complete and machine-readable: protected-resource metadata → authorization server metadata at `auth.atlassian.com`, which advertises a dynamic client registration endpoint, PKCE S256 as the only challenge method, the refresh-token grant, and public-client token auth. The P3 oauth-flow engine can therefore self-register a client against the loopback redirect instead of requiring a bring-your-own app. The shipped manifest now pins the bearer the engine will produce: `Authorization: { $cred: atlas }`, resolved by mcp-client from the token store under the connector id as `Bearer <accessToken>`.

## Decision

1. **One field per credential reference.** The wire view of a token method now carries its `credentialRefs` (public manifest data — reference names, never values), and the client dialog renders one password field per reference, labeled by the reference name itself (a technical identifier, not translatable copy). The save is disabled until every reference is non-empty and stores all values in one `configure` call through `fields.credentials` (the host's per-reference map); `fields.token` remains a wire-level shortcut for the first reference.
2. **The shipped manifests match what the servers actually require.** `slack.yml` declares `SLACK_BOT_TOKEN` and `SLACK_TEAM_ID` (the live case for the multi-reference dialog); `atlas.yml`'s server carries the bearer header above.
3. **The shipped-catalog e2e is hermetic.** It pointed `$DSH_HOME` at a temp home before boot: it asserts every row is `unconfigured`, which a developer's ambient home (configured connectors, mounted servers) breaks. The temp home gets the profiles module-fallback heal the app boot needs.

## Alternatives considered

**Keep a single field and derive the Team ID from the bot token.** Rejected: the archived server does not derive it, and a server that requires a value at startup must declare it; the dialog asking for what the server needs is the honest surface.

**Render a fixed "Token" field plus an advanced free-form map.** Rejected: the method's declared references are the complete, validated set (the manifest parser rejects a slot referencing an undeclared ref); a free map would let the client store references the host would refuse anyway.

**Switch the Slack manifest to a maintained community server.** Parked: the community candidates are Go-based servers without a clean `npx` stdio story, and the archived reference server still starts, lists its tools, and needs only the two declared values. Revisit if the package is removed from the registry.

## Consequences

- A single-reference token dialog is visually unchanged (one field, now labeled by the reference name instead of the word "Token"); multi-reference methods (the shipped slack, the self-hosted atlas fixture) render one field per reference.
- The `dialog.token` locale key is gone from all three dictionaries; the field labels are data, not copy.
- The P3 engine's contract is pinned by the shipped manifest: store the bundle under the connector id, and the existing `{$cred}` seam presents it.
- A token that is syntactically stored but rejected by the provider still shows the server `connected` (the Slack server does not authenticate at startup); the first tool call is where it surfaces.

## Related

- [Connectors P1 — credential references and the preset roster](../architecture/2026-08-23-connectors-cred-refs-and-presets.md) — the `{$cred}` seam this note's atlas header rides on.
- [Connectors — the chat-screen region](../architecture/2026-08-23-connectors-chat-region.md) — the region and dialog this note extends.

Deferred, in order: P3 oauth-flow engine (DCR + PKCE + loopback 8766, real `connector.complete`), P4 M365 device-code flow, P5 custom-connector UI.
