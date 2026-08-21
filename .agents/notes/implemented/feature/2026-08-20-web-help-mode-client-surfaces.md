# Agent Note: `/help` and `/mode` — client-side slash surfaces over the command UI

Status: implemented

English | [中文](2026-08-20-web-help-mode-client-surfaces.zh.md)

## Problem

Two of the deployment's most-used slash commands had no comfortable Web path. `/help` did not exist at all: a user who wanted "which slash commands can this session run" had to open the `/` menu, scroll, and close it again. And `/mode` — the host preset switch — was an argument-bearing command on the Web, so a bare pick or bare Enter just failed with the usage line while the user still had to know the preset id and type it.

## Decision

`/help` is a client surface in `@deepseek-ai/dsh-client-ui-slash-tools` (the Web slash-tool feature owner) over `ctx.commandUi`; `/mode` is a decoration registered by `@deepseek-ai/dsh-client-ui-agent-preset`, the package that owns the preset roster it renders (see [slash-surface ownership](../architecture/2026-08-21-slash-surface-ownership-to-feature-packages.md)); and `@deepseek-ai/dsh-client-ui-commands` gains the one contract method this requires.

`CommandUiContract` gains `menuRows(session, signal)`: the merged slash-menu view (host catalog + available client contributions, menu order, the chat-session `/permission` hide included) without position or query filtering. It is the same row synthesis the `/` menu already runs, factored out of `candidates()` so the menu and the face cannot drift apart.

`/help` is a client contribution (popupSelect): its options are exactly `menuRows` rendered as `/name` rows with the row descriptions. Picking a row closes the popup and runs nothing — the listing is the answer, and running a command from it would duplicate the menu's own dispatch with none of its span handling.

`/mode` is a decoration (popupSelect) on the host command: a bare pick opens the preset roster from the `agentPreset.list` wire read, with broken presets omitted (the picker rule — a broken preset cannot recompose a session), the session's current preset marked active, and chat sessions excluded (the host refuses the switch in both directions). A pick submits the completed `/mode <preset>` line through the commands Remote — deliberately the host command, not the `agentPreset.select` RPC, which is blank-only (the composer seat's flow). Submitting through the command's own admission path keeps the host's idle guard, chat guard, recomposition, and `agent-preset/selected` record in one place, and keeps the browser's `command/executed` observers pointed at one submit channel.

## Alternatives considered

- **`/mode` via the `agentPreset.select` RPC.** The wire already exists. Rejected: it refuses started sessions (`agent-preset-locked`) — the exact sessions `/mode` serves — and would bypass the command's lifecycle logging and the `agent-preset/selected` record.
- **A `/help` host command.** It would list the session's own catalog, which the host can read. Rejected: the Web menu must also show client-only contributions (`/clear`, `/help` itself), and the merged view exists only in the client's command service — a host command would need a second catalog source to be complete.
- **`/help` rows that run the picked command on selection.** Rejected: menu pick already owns dispatch with span/token handling; a second dispatch path from a help popup would duplicate that machinery for a feature (informational listing) that needs no behavior.

## Consequences

- `CommandUiContract` is no longer register/decorate-only: business packages can now read the merged menu they register into. The method has exactly one current consumer (`/help`); its row shape stays minimal (name + description) so a future consumer does not push the face wider.
- The `/mode` roster read is one `agentPreset.list` call per popup open — the same unmemoized discovery the settings section and the new-session chip use.
- The `/help` and `/clear` descriptions are registry-held text read once at registration; they refresh on re-registration, not on a locale change (README limitation).
- Both new surfaces are Web-only by construction (client plugins); a CLI `/help` would be a separate host command and remains deferred.
