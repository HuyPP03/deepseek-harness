# Agent Note: `/mcp` on the Web — the MCP settings section and the panel deep link

Status: implemented

English | [中文](2026-08-21-mcp-client-surface-and-settings-panel-deep-link.zh.md)

## Problem

The host-side `/mcp` command (see [the `/mcp` status view](2026-08-20-mcp-status-command.md)) answered "which servers are connected and healthy" as chat text — and stopped there. The Web had no surface where a user could answer the other half of the question: what should change? The user MCP servers (the `managed` rows of `mcp.list`, declared under `$DSH_HOME/.mcp/`) could only be edited by hand as YAML files, a flapping server could only be reconnected by restarting the deployment, and the `/mcp` menu pick had no place to go that was not a chat bubble.

## Decision

One new package — `@deepseek-ai/dsh-client-ui-mcp` — owns both Web surfaces over the existing `mcp` wire calls, and one service in `@deepseek-ai/dsh-client-ui-settings-general` becomes the deep link between them:

- **The MCP settings section** (slot `settings.section`, id `mcp`, order 40 — after the existing feature sections, because MCP servers are deployment-level wiring, not per-session configuration). One controller (`McpSectionController`) owns one snapshot: the roster pull, the add form, the remove gate, and the in-flight reconnect. Rows show name, status, and tool count; **add** opens a modal form (stdio: command/args/env/cwd; streamable-http: url/headers; shared timeout) that validates, parses the line formats, and submits `mcp.add`; **remove** is offered only on `managed` rows and sits behind the `RiskConfirmation` gate; **reconnect** is per-row, also gated. Every write re-reads the roster afterwards — the host stays the single fact source, and the page never keeps its own copy of a server.
- **The `/mcp` decoration** (popupSelect) on the host command: a bare `/mcp` pick opens the roster as rows carrying `detail` (status · tools) and a `confirmation` block, so reconnecting is a deliberate two-step act that names what it interrupts; a trailing `__add__` row deep-links into the settings section instead of running anything.
- **`SettingsPanelController`** — a cordis `Service` in ui-settings-general, registered as `settingsPanel`, holding the panel's `{ open, activeId }` with actions `openSection(id?)`, `closePanel()`, `setActiveId(id)`. `SettingsRoot` used to keep that state in local `useState`; it now renders from the controller's store and exposes the three actions through its inject face, so a registrant outside the panel (the `/mcp` popup) can open it on a chosen section.

## Alternatives considered

- **A raw roster list in the `/mcp` popup, no gates.** Rejected: the popup's only actionable row is reconnect, and reconnect interrupts in-flight tool calls — the same reason the section's remove and reconnect use `RiskConfirmation` is exactly what a bare one-click row would skip.
- **The add form inside the `/mcp` popup itself.** Rejected: a six-field validated form does not fit a one-stage menu popup, and the section is where the roster already lives; the popup's job is to point there (`__add__`) and to reconnect.
- **A custom deep-link mechanism** (a slot event, a global callback). Rejected: cross-plugin shared state with actions is the established cordis-service pattern; a second, ad-hoc channel for one consumer would be the anomaly.
- **Mounting the section in ui-slash-tools with the `/mcp` decoration.** Rejected: the section and the decoration both render the MCP data; the package that owns the data owns both surfaces (see [slash-surface ownership](../architecture/2026-08-21-slash-surface-ownership-to-feature-packages.md)).

## Consequences

- ui-settings-general now publishes a cross-plugin service: ui-mcp is its first consumer by `ctx.inject(['settingsPanel'])`. Panel state moved from React-local to a cordis snapshot store; `SettingsRoot` renders through `hooks.settingsPanel` and its own open/active actions are the controller's.
- The [host-side `/mcp` note](2026-08-20-mcp-status-command.md) is no longer "host-only": its status view is the popup's data source on the Web, and the note's consequences list says so.
- The add form parses and omits empty fields into the wire `McpServerSpec`; the host's `mcp.add` remains the validator of record (duplicate names, unmanaged targets, and the `serverName` rule are refused there, and the page shows the host answer on the form).
- `mcp.list` stays the only read: the popup, the section, and the host command all pull from it, so the three surfaces cannot drift.
