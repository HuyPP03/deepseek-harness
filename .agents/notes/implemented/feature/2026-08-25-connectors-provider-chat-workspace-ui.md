# Agent Note: Connectors — provider chats hide their workspace UI

Status: implemented

English | [中文](2026-08-25-connectors-provider-chat-workspace-ui.zh.md)

## Problem

A provider chat (a session whose agent runs a connector preset) carries no code project, yet three surfaces still offered it workspace machinery: the hero's "Choose workspace" picker, the `@` file-mention source (which lists the session's project files), and the `/goal` and `/mcp` slash rows (a long-running-task steer and an MCP-server listing). Each was inert or misleading in a provider conversation.

## Decision

The existing `connectorPresetIds` fact — a session whose `agentPreset` is in the connectors' roster preset set is a provider chat — drives the hide across the three surfaces, all client-side:

1. **The hero workspace picker (`client/ui-workspace`).** `WorkspacePicker` reads the current session's `agentPreset` through `useSessions` and the preset set through the `useConnectorPresetIds` hook; when the current session is a provider chat it renders nothing. The conversation's own "Choose workspace" chip stays visible but inert — a deliberate trade of not touching `ui-conversation`.

2. **The `@` file-mention source (`client/ui-file-mention`).** Its `candidates`/`warm` path asks a call-time `isProviderChat(sessionId)` — the list snapshot's `agentPreset` against the connectors' set, read lazily because the connectors plugin may activate after this one. A provider chat lists nothing, like an addressed subagent.

3. **The `/` slash menu (`interaction/commands` + `client/ui-commands`).** A command opts out of a provider chat's menu with a `providerHidden` flag on its definition; the host advertises it on the `CommandDescriptor`, and the client's `menuRowCandidates` drops flagged rows when the session preset is a connector preset. `/goal` and `/mcp` set the flag. A typed line still reaches the host — only the menu row is hidden, matching the existing "chat sessions hide `/permission`" rule.

## Alternatives considered

**Filter the slash commands in the host's `command.list`.** Rejected: the host `list` method is synchronous while the connector roster is read asynchronously; doing it host-side would force the low-level commands service to cache and depend on the connectors domain. The client already holds both the session preset and the preset set, so the filter sits where its inputs already live.

**Gate on "the session has no workspace".** Rejected: an ordinary (non-provider) chat also has no project, so that gate would drop the workspace commands from ordinary chats too. The connector-preset set is the precise "this is a provider chat" signal and stays consistent with the Chats-tab exclusion.

**Hard-code the hidden command names client-side.** Rejected in favor of the `providerHidden` flag: the flag is self-documenting on each command and decouples the client filter from "which commands are workspace-oriented".

## Consequences

- In every composition where the connectors plugin loads, a provider chat's hero shows no workspace picker, its `@` source lists nothing, and its `/` menu omits the `providerHidden` rows; a composition without the connectors plugin is unchanged (the set is empty and the filters are no-ops).
- The hero "Choose workspace" chip remains visible but inert in a provider chat — the accepted cost of not editing `ui-conversation`.
- `providerHidden` is an additive wire field: an older client ignores the flag and shows the rows; a newer client against an older host simply never sees a flagged row.
- The `connectorPresetIds` fact now serves four client surfaces through the same ctx-service channel (Chats-tab rows, Chats search, the hero picker, the `@` source, and the `/` menu).

## Related

- [Connectors — provider chats excluded from the Chats tab](2026-08-25-connectors-chats-tab-exclusion.md) — the `connectorPresetIds` service and provider-chat signal this note reuses.
- [Connectors — provider card grid, per-tab New, and the provider chat list](2026-08-24-connectors-provider-card-grid-and-chat-list.md) — the provider preset's hiding from the new-session chip.
- [The no-Workspace composer opens the existing picker](2026-08-07-workspace-picker-composer-entry.md) — the picker this change nulls for a provider chat.
