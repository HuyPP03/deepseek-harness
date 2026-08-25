# Agent Note: Connectors — provider chats excluded from the Chats tab

Status: implemented

English | [中文](2026-08-25-connectors-chats-tab-exclusion.zh.md)

## Problem

The provider detail already listed a connected provider's chats, but the sidebar's Chats tab — and its search — listed the same sessions again as ordinary ungrouped rows. A provider conversation thus appeared in two browsing homes, and a search that matched a provider chat title or body opened it from the Chats tab instead of the provider's own detail.

## Decision

The provider detail becomes the exclusive browsing home for provider chats, through one cross-plugin client service:

1. **`client/ui-connectors` publishes the roster's preset ids.** `apply` provides a `connectorPresetIds` ctx service: a `createSnapshotStore<ReadonlySet<string>>` that an effect syncs from the shared controller's roster. The store republishes only when the id set itself moves (size or membership), so a selection or dialog change that keeps the roster intact is a no-op snapshot for consumers.

2. **`client/ui-workspace` consumes it lazily into a stable source.** The browser inject face gains a `hooks.connectorPresetIds` entry (the renderer binds it to `useConnectorPresetIds`). Activation order between the two plugins is unconstrained, so the consume side holds a local snapshot store that mirrors the service: it starts empty, rebinds on the `internal/service` ledger event, and returns to empty when the provider disposes. The hook always exists; a composition without the connectors plugin simply filters nothing.

3. **`deriveChats` and `deriveSearchResults` take the set as a plain data argument** and drop every session whose `agentPreset` is in it — rows and search alike, title matches and backend content hits. The component reads the set through the bound hook and passes it down as data; the hook never crosses the component boundary.

## Alternatives considered

**Capture `ctx.get('connectorPresetIds')` in the inject factory at registration.** Rejected: the renderer caches the root inject face per entry, and the connectors plugin may activate after the workspace browser is already bound (activation order is unconstrained). Capturing at bind time would pin an empty source for the session's lifetime.

**Have ui-workspace inject the service as a hard dependency.** Rejected: `inject` waits on the named service, and the connectors plugin is an optional composition member — a deployment without it would stall the workspace browser's activation on a provider that never arrives.

**Filter on the host session feed instead.** Rejected: the feed is the shared session-list projection every surface reads; the provider detail itself filters by `agentPreset` from the same feed. Hiding provider sessions at the feed would force the detail to carry its own session list, and the "which presets are connector presets" fact belongs to the connectors roster, not to the session domain.

## Consequences

- Provider chats leave the Chats tab's rows and its search in every composition where the connectors plugin loads, regardless of which surface activates first.
- The Chats tab's persisted `sessionOrderByAccount` order for an ungrouped provider chat keeps its slot in the stored order array; the row is absent but the order entry remains until the account's next retention pass.
- A deployment composing the connectors plugin out (or before it loads) sees no change: the source is an empty set and the filter is a no-op.
- The `connectorPresetIds` service is a bare snapshot store — the first cross-plugin reactive fact between the two browsing plugins, carried by the ctx service channel rather than a slot (no slot hole exists between the surfaces).

## Related

- [Connectors — provider card grid, per-tab New, and the provider chat list](2026-08-24-connectors-provider-card-grid-and-chat-list.md) — the detail list this exclusion completes; the provider preset's hiding from the new-session chip.
- [Lazy MCP tool bridge](2026-08-25-lazy-mcp-tool-bridge.md) — the other 2026-08-25 connectors change in this PR.
