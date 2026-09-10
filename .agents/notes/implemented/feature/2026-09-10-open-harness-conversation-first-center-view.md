# Agent Note: Conversation-first center view and the session-open return

Status: implemented

English | [中文](2026-09-10-open-harness-conversation-first-center-view.zh.md)

## Problem

The header tabs (Chats / Workspaces / Connectors) now each open a full-column dashboard in the center view, so the center alternates between the conversation and a dashboard. Two failure modes appeared:

1. **Cold start covered the conversation.** The default tab's dashboard mirrored into the center on mount, hiding the conversation hero (or the open session) behind an overlay before the user had done anything.
2. **A session open could strand the user on a dashboard.** While a blocking interaction (plan approval, an ask-user question, a workflow member) was pending in the conversation, clicking a session row or card from a browsing surface re-selected the *already-current* session. The session store treats that re-open as a no-op, so the header's session-yield effect (which returns the center to the conversation when a session becomes current) never retrigered, and the center stayed covered by the dashboard — the pending card unreachable, and e2e clicks timing out because the dashboard overlay intercepted pointer events.

## Decision

The center view is **conversation-first**:

- A cold start renders the conversation — the hero when no session is current, the current session otherwise. The header's tab-mirroring effect skips its first render (`isFirstRender` ref) so boot never covers the conversation. The default tab is Chats.
- A header tab *click* is the only browsing gesture that mirrors its dashboard into the center.
- Every session-open path from a browsing surface — the sidebar `open`, the Chats dashboard card, the Workspaces dashboard card, and the connector directory — calls `ctx.layout.setCenterView('conversation')` in the same step as `ctx.sessions.open(sessionId)`. This covers the already-current-session re-open, where the store change alone would not retrigger the yield. `startChat` / `startSession` / fork paths create a *new* session id, so they rely on the yield effect and do not call `setCenterView`.

`ui-workspace` gains the `layout` service in its `inject` list (plus the `oh-client-ui-layout` devDependency and tsconfig reference) for the explicit return.

## Alternatives considered

**Keep tab clicks sidebar-only (no center mirror).** Rejected: the redesign's intent is that each tab enters its dashboard; a tab click that changes only the sidebar region would make the tabs feel broken.

**Rely solely on the session-yield effect for the return to the conversation.** Rejected: a re-open of the already-current session is a no-op on the session store, so the yield never fires and the user stays stranded on the dashboard. The explicit `setCenterView('conversation')` makes the return deterministic for every open path.

**Automatically switch the center to the conversation whenever a blocking interaction appears.** Rejected: it would yank the user out of a dashboard they deliberately opened; the return happens on the user's own next navigation gesture (opening a session) instead.

## Consequences

- Opening a session from any dashboard or sidebar region returns the center to the conversation in the same step; no path can leave a pending card covered by a dashboard.
- e2e scenarios that assert a sidebar/dashboard row while a card is pending must return by row-click (the natural user gesture) before clicking the card — `plan-review` and `question-composer` do this.
- `ui-workspace` now depends on `@open-harness/oh-client-ui-layout` (type-only context merge plus the `setCenterView` call).
- The boot overlay regression is covered by the `HeaderRoot` client spec (no center-view write on first mount; one write per tab click; the session-yield effect returns to the conversation).

## Related

- [Open Harness dashboards, dark palette, and brand-red accent](2026-09-10-open-harness-dashboard-and-red-accent.md) — the dashboard surfaces this return gesture leaves.
- [Web chat sessions and the sidebar browsing tabs](2026-08-20-web-chat-sessions-and-sidebar-tabs.md) — the sidebar tab store the header tabs mirror.
