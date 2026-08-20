# Agent Note: `/clear` — the client's fresh-session action

Status: implemented

English | [中文](2026-08-20-clear-command-fresh-session-action.zh.md)

## Problem

Restarting a conversation in the Web GUI took the long way: New Session button (or a new tab) while the old session kept its context. There was no command-line way to say "discard this conversation, keep everything else (workspace, preset)" — and the command surface's new `action` kind (menu pick or bare enter runs a client behavior directly) had no first user.

## Decision

A new client package, `ui-slash-tools` (Web-only, like every client plugin), contributes `/clear` to `ctx.commandUi` as an **action**:

- **Available only on a session with something to clear** — the capability filter reads the session list snapshot and withholds the row for a blank current session (and for an unknown id); the behavior re-checks blankness at run time, so a session that went blank between the menu pass and the pick no-ops.
- **The behavior is one create and one open**: mint a fresh session through the newly outward `ISessions.create` face (the `SessionRuntime.create` that `workspaces.startNewSession` already used internally), joining the current session's Workspace by account membership (the same rule the New Session reuse scans use; a chat session carries none) and riding the current row's `agentPreset` when present, then `open` the new id so the navigation lands on it. The old session stays in the list untouched.
- **Failures are log-only**: the action kind has no result channel — a refused create rejects the run promise and the command service logs it. That is the right surface for a convenience shortcut the user can repeat from the menu, and it keeps the package free of an error store or retry UI.

Exposing `create` on `ISessions` is the explicit widening the contract's header describes: the method existed on the concrete runtime for the workspaces flow, and the action kind is the first consumer that needs it outside that domain. The test runtime's `TestSessions` double gains a matching recorded stub that materializes a blank, unselected fixture row so `open` can target it.

## Alternatives considered

- **`workspaces.startNewSession` instead of `sessions.create`.** Rejected. The hero New Session flow reuses the Workspace's blank session (a `/clear` that lands in an existing blank is a no-op the user cannot see) and carries no `agentPreset`, so the fresh session would silently run the deployment default instead of the composition it replaces.
- **A host command (like `/effort`).** Rejected as an invented scope: nothing here needs Host state — the session, its Workspace membership, and its preset are all in the client's own list snapshots, and the write is the plain `session.create` RPC the client already owns. A host command would also vanish from the Web-only surface without buying any capability.
- **Carrying the session's reference Workspaces over.** Deferred. The list summary carries no reference axis, so the client cannot see them from the action's data source; minting with references would need a new summary field or an RPC round trip for a case the menu does not advertise.

## Consequences

- `/clear` is Web-only (client plugin), offered in the slash menu and on bare enter; a typed `/clear <args>` line is not claimed (the action kind takes no arguments) and goes nowhere.
- A cleared session's reference Workspaces are not carried over (Known Limitation in the package README); everything else — Workspace, preset — is.
- The fresh session is blank by definition and never auto-selected by the create; the action's `open` is what moves the stage.
