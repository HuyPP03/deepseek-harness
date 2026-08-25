# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

Sidebar shell plugin: the wordmark, New action, browsing tabs, layout-owned collapse control, scroll-aware region seat, and bottom-pinned Settings seat. [ui-workspace](../ui-workspace/README.md) owns the Session browser rendered into `sidebar.workspaces`; this package neither derives its rows nor owns its view preferences. Collapse into the layout-owned 56px rail remains presentation-local. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The shell owns the browsing tab store (`chats` | `workspaces` | `connectors`, persisted as `dsh.sidebar.view.v2`, default `workspaces`): the wide column renders the three-tab list above the New button, and the active tab selects the region registrant — `chats` and `workspaces` hand the tab to the `sidebar.workspaces` owner, which renders the flat chat list or the Workspace tree, while `connectors` swaps the region for the `sidebar.connectors` registrant (the [ui-connectors](../ui-connectors/README.md) list). The tab is the sole driver of the center column's full-column view: the shell pushes `setCenterView('connectors')` on the connectors tab and `setCenterView('conversation')` on the others, so the [browse directory](../ui-connectors/README.md) overlays the conversation column exactly while the tab shows the list (a persisted-tab restore on load takes the same path). The wordmark and New button act on the active tab: Workspaces starts the runtime's page-local frontend Session Intent ("New Session"), Chats starts a chat ("New Chat"), reusing the current blank chat session or minting one with `agentPreset: 'chat'` and opening it; the connectors tab renders no New control (the region's own "New connector" mints its entries). The rail has no tab control; its New icon follows the persisted tab.

New Session starts the runtime's page-local frontend Session Intent. The runtime targets the explicit Workspace used by a scoped action, otherwise the current Session's Workspace, otherwise the most recently active Workspace; when none exists it clears into the blank New Session page. Workspace-specific controls and the shared picker belong to ui-workspace.

`SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared `sidebar.workspaces`, `sidebar.connectors`, and `sidebar.settings` child slots, the shell tab store, and injected `startSession`/`startChat`/`setCenterView` plus sidebar-toggle callbacks.

During a live collapse, the shell holds the expanded content at its current width while it fades out for 150ms. The four upper controls—the shell toggle and New Session plus add and search rendered through `sidebar.workspaces`—then share one 150ms fade and 49px leftward translation into the 56px rail, ending with the layout's 300ms column slide; every 36px control box follows the same path to the rail's 10px left inset. The bottom-pinned `sidebar.settings` control shares the fade timing but has no horizontal translation. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions.

Scrollbars in the column are a pointer affordance: the shell rebinds ui-theme's [scrollbar indirection](../ui-theme/README.md) to `transparent` whenever the pointer is outside it, and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The reservation that keeps rows from moving belongs to the scrolling region ([ui-workspace](../ui-workspace/README.md)), so revealing a thumb never reflows.

The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`); ui-settings registers the trigger row and settings panel there.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

## Model Experience

None, as the sidebar renders the browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Session state-dot rendering is owned by [ui-workspace](../ui-workspace/README.md)** — no done/error notification sources are available.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to [ui-workspace](../ui-workspace/README.md), not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
