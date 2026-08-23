# Agent Note: Connectors — the chat-screen region (sidebar tab + client/ui-connectors)

Status: implemented

English | [中文](2026-08-23-connectors-chat-region.zh.md)

## Problem

P0a gave connectors their host-side identity, the `connector.*` verbs, and the shipped catalog, but the chat screen had no surface to browse, configure, connect, or disconnect them. A token entry point had to exist on the client without the client ever retaining a secret, and the sidebar needed a browsing place for the roster beside the chat list and the Workspace tree.

## Decision

Two parts:

1. `client/ui-sidebar` gains a third browsing tab. The tab store is now `chats | workspaces | connectors`, persisted as `dsh.sidebar.view.v2` with default `chats` — a value persisted under the old `v1` key is treated as absent. The shell declares a new `sidebar.connectors` child slot (single, root scope) and swaps the region for the registrant on that tab; on the connectors tab the wordmark and New start a chat, exactly as on the chats tab (no Session Intent). Collapse and rail behavior are unchanged.

2. `client/ui-connectors` is a new plugin package that registers the roster region into the `sidebar.connectors` hole through `ctx.slots.inject('sidebar', ...)`. The region lists the secret-free `ConnectorView` rows (state dot, server count, lastError) and drives a pinned state-to-action map: an unconfigured token method offers the Configure dialog, `needs-auth`/`down`/`error` offer Connect, `connecting`/`connected`/`reconnecting` offer Disconnect, and `authorizing` offers no action. The token dialog is the only place on the client a credential value is entered; the draft is sent once through `connector.configure` and cleared on success. A controller owned by the apply closure drives the page; the component reaches it through the inject `hooks` compartment as `useConnectors`. The controller's api surface is deliberately the four wire calls the region uses (`list`, `configure`, `connect`, `disconnect`) — `complete`, `add`, and `remove` stay host-side until the oauth-flow engine and the custom-connector UI land. Mutation responses carry the authoritative post-operation view, which the page adopts into its roster instead of re-listing, and a single-flight `busyId` gates every row action at once. The rail renders a link icon that requests expansion.

All row copy rides the locale dictionaries, `en` the key-set source of truth with `zh` and `vi` riding.

## Alternatives considered

**Render the roster inside the `sidebar.workspaces` region.** Rejected: connectors are not session or workspace concerns; a shell-owned tab plus hole gives the roster a first-class place and leaves ui-workspace's ownership boundary untouched.

**Per-row busy state and per-row error queues.** Rejected: one in-flight mutation matches the single host-side credential store and the single-flight gate keeps the controller simple; the row error is still recorded per row.

**Re-list the roster after every mutation.** Rejected: the host derives the view from the same catalog, credential, and registry facts the mutation just committed, so the response row is authoritative and a re-list would be a wasted round trip.

## Consequences

The chat screen now carries the connector surface, and the client retains no secret after the dialog closes: `list` is structurally secret-free host-side, and the dialog's draft is cleared on save. Costs: the sidebar persistence key moved to `v2`, so a previous tab choice resets to `chats`, and the region shows its empty state on deployments that compose no connectors service (a valid deployment, not an error). A maintenance fact worth keeping: client tests resolve workspace imports through tsconfig `paths` into `src`, so a stray build artifact emitted inside a client package's `src/` — or a stale `lib/` — breaks that resolution and misattributes the failure (a `window is not defined` reported in an unrelated file); keep the source plane clean after any build.

## Related

- [Connectors — the host foundation](2026-08-23-connectors-host-foundation.md) — the state machine and verbs this page drives.
- [Slot system standard](2026-07-22-slot-type-chain-implementation.md) — the composition pattern behind the new hole.

Deferred, in order: P1 `{$cred}` placeholders in mcp-client and the preset roster, P3 oauth-flow engine with real `connector.complete`, P4 device-code flow, P5 custom-connector UI.
