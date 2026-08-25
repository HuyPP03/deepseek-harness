# Agent Note: Connectors — provider card grid, per-tab New, and the provider chat list

Status: implemented

English | [中文](2026-08-24-connectors-provider-card-grid-and-chat-list.zh.md)

## Problem

The Connectors tab listed providers as rows, the sidebar's New control always meant "new chat", and a connected provider's detail view showed only its server state — none of its own chats. A user who connected Slack to start a Slack-mode conversation had no path from the provider card to the sessions that conversation would produce, and the new-session chip still offered the provider preset alongside the ordinary modes, even though the provider's own chats live in the Connectors tab.

## Decision

Three parts, all client-side:

1. **Three tabs.** The sidebar's tablist shows Chats, Workspaces, and Connectors. The New control follows the active tab: Chats labels it "New chat" and reuses-or-mints the ungrouped blank chat, Workspaces labels it "New session" and starts a workspace session, and the Connectors tab renders no New control (the region's own "New connector" mints its entries).

2. **The provider roster renders as a two-column card grid** (`client/ui-connectors`). The card keeps the row anatomy — state dot, name, description, actions — but its elevated surface rebinds the l2 scrollbar pair so the grid scrolls with the pointer-revealed bars the sidebar already owns.

3. **The connected provider's detail lists its own chats.** The region injects `openSession` and `newProviderChat` from the client context's `sessions` service. The detail view filters `sessions.ids` by `agentPreset === provider.presetId` (the wire view's `presetId` field is the session's `agentPreset`), sorts by `updatedAt` descending, and renders each as a clickable row that opens the session. A "New chat" button in the provider header calls `sessions.create({ agentPreset: provider.presetId })` and opens the result. Unconnected providers show a placeholder; a connected provider with zero sessions shows an empty note.

4. **The new-session chip hides provider presets** (`client/ui-agent-preset`). The seat controller reads `connector.list` alongside the roster and drops every option whose id a composed connector claims (`presetId` field). The Settings roster keeps the full list — it manages the presets the deployment ships, provider presets included — and a session that already runs under a hidden preset still resolves its label by id, so the filter never strands an existing session's display.

## Alternatives considered

**Keep the provider roster as rows and add a "chats" sub-tab to the detail view.** Rejected: the detail view is already a single scroll region; a second sub-tab would duplicate the tab mechanism the sidebar already owns, and the provider's chats are not a different browsing mode — they are the provider's own output, which belongs in the same view as its state.

**Re-list the provider's chats after every `sessions.create`.** Rejected: the create RPC returns the new session's id, and the session list's own `session/created` event (the forwarder the sidebar already listens to) adds it to `sessions.ids`; the detail view re-renders from the snapshot, so a re-list would be a wasted round trip.

**Filter the provider preset out of `presetOptions` itself, so every surface that reads the roster sees the filtered list.** Rejected: the Settings page's roster must manage every preset the deployment ships, including provider presets — a user who wants to delete or copy the Slack preset needs it there. The filter belongs at the seat's own options path, which is the one surface whose job is to offer the next session's mode.

**Give the chip its own `connector.list` read, separate from the seat's.** Rejected: the seat already reads the roster on every load and on settings invalidation; one additional call in the same `load()` keeps the two reads consistent (a roster that changes between the two reads would show a provider preset the seat just hid) and costs nothing — the call is a single wire round trip, and the seat's `load()` already awaits the roster read.

## Consequences

- The sidebar's New control is now tab-aware: its label and action change with the active tab, and the Connectors tab renders none (the region's own "New connector" owns that surface).
- The provider detail view is the only place a user can start a session under a provider preset without going through the new-session chip — the chip hides the preset, so the path is the provider's own "New chat" button.
- The seat's filter is client-side only: the host still composes sessions under provider presets, and the wire view still carries `presetId`. A future host-side change that removes provider presets from the roster would make the filter a no-op.
- The card grid's scrollbar rebind follows the pointer-revealed contract: the elevated surface rebinds the l2 pair, and the gate admits exactly two rebind targets (the l2 pair or `transparent`).
- The provider detail's session filter is by `agentPreset === presetId`, which is the same field the session summary carries. A session that began under a provider preset and then switched (impossible today — the host refuses to adopt an existing session under a different preset) would leave the list.

## Related

- [Connectors — the chat-screen region (sidebar tab + client/ui-connectors)](../architecture/2026-08-23-connectors-chat-region.md) — the tab and region this note's card grid and detail view extend.
- [Connectors P1 — credential references and the preset roster](../architecture/2026-08-23-connectors-cred-refs-and-presets.md) — the `presetId` field the detail view and the seat's filter both read.
