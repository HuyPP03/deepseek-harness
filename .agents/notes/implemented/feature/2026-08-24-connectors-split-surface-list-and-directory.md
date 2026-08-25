# Agent Note: Connectors — the split surface: sidebar connected list plus the main-area browse directory

Status: implemented

English | [中文](2026-08-24-connectors-split-surface-list-and-directory.zh.md)

## Problem

Two failures in one session: a runtime crash and an UX mismatch. Clicking a provider in the sidebar Connectors tab threw React error #310 ("Rendered more hooks than during the previous render") and wiped the whole app, because the region's provider detail called a session hook only inside a conditional branch, changing the hook count across list/detail renders. The surviving layout also fought its own column: the full roster, the card grid, the provider detail, the token dialog, and the custom-connector form all lived in the 56px-to-a-few-hundred-pixels sidebar, so the detail's chat list and the form's fields had no room, and the connected provider's chats — the thing a user actually went to Connectors for — opened into a conversation column the sidebar never touched.

## Decision

Split the one domain across the two columns it already spans, with the layout owning the seam:

1. **The layout gains a full-column center view.** The layout store carries `centerView: 'conversation' | 'connectors'` (set through `ctx.layout.setCenterView`, exported as `CenterView`), and the AppFrame declares a `main.connectors` hole rendered as an absolutely-positioned overlay over the center column. The conversation column stays mounted underneath, so switching never loses session state.

2. **The sidebar tab drives the center view, and the directory gives it back.** `SidebarRoot` pushes `setCenterView('connectors')` on the connectors tab and `setCenterView('conversation')` on every other tab, through an injected `setCenterView` callback; a persisted-tab restore on load takes the same path, and a tab click re-asserts the view even when the tab is already active. The one return path: opening a session from the directory (a chat row or **New chat**) calls `setCenterView('conversation')` in the same step as the `sessions.open` — the chat opens in the conversation column the overlay covers, and the sidebar tab stays on connectors, so the next click on that tab brings the directory back.

3. **ui-connectors registers two surfaces over one controller.** The same `apply` closure registers `ConnectedProvidersList` into `sidebar.connectors` and `ConnectorsDirectory` into `main.connectors`, and both faces bind the closure's single `ConnectorsSectionController` store. The list face is the minimal selection subset (`load`/`selectProvider`); the directory face carries the full callback set. Both surfaces call `load` on mount and the controller single-flights the roster read, so the two mounts cost the host one wire verb.

4. **The sidebar keeps only the connected providers** — state dot, name, a `Custom` badge — one row each, click or Enter selects the provider. The full roster moves to the directory as a card grid: state, description, the server summary, and the state-following actions (Configure/Connect/Disconnect/Remove) now render in a column wide enough for them. A card click starts the flow its state and credential method require — the token dialog, the browser OAuth flow, the device-code flow, or the plain connect — and only a live or settling card opens its detail. The Connect action itself widens to every unconnected state that has a path: `needs-auth`, a failed mount (`down`/`error`), and an unconfigured browser sign-in or device code; the token method still offers Configure until its token is stored.

5. **Risk notes derive client-side from the secret-free view.** Each card lists up to three failure-mode lines — the token reference a connect depends on (and a stored token's revocability), the browser sign-in or device code whose grant can expire, the unmounted server count, the custom connector's reachability — most actionable first. No wire change: everything comes from `ConnectorView` fields the roster already carries.

6. **The provider detail and the custom form live in the directory.** The selected provider's chats (preset-filtered, blank hidden, latest first) and **New chat** render at full width; the token dialog and the **New connector** form open over the directory.

## Alternatives considered

**Keep the whole roster in the sidebar and fix only the crash.** Rejected: the crash fix (running the session hook unconditionally) is kept, but the sidebar column cannot host a chat list and a form at usable widths; the provider's chats belong in the conversation column's neighborhood, and the directory's cards need room for risk notes and the server summary.

**Give the directory its own top-level navigation entry (a fourth sidebar tab or a header button).** Rejected: the sidebar's connectors tab is already the user's mental entry to "connections"; a second entry would split the domain's navigation and let the two drift. The tab stays the single door, and the layout's overlay is the only thing that moves.

**Make the directory a separate plugin package.** Rejected: one domain, one controller, one wire verb — two seats of one registrant set. A second package would duplicate the controller or invent a cross-package state channel the slot system explicitly refuses to host.

## Consequences

- The AppFrame's `main.connectors` overlay is absolute over the center column; the conversation tree stays mounted (no state loss), and the overlay unmounts entirely when the tab leaves connectors — the apply-closure controller outlives both surfaces.
- The sidebar's `sidebar.connectors` face is minimal by contract; a future surface that needs more of the domain reads the directory face or the shared store, not a widened list face.
- Risk notes are copy in the `connectors` locale namespace (`risk.*`), derived in package-internal `risks.ts`; the wire stays secret-free and unchanged.
- The 2026-08-24 card-grid decision survives in content but moves in location: the grid is now the directory's card grid, and the sidebar's per-tab New-control rule is unchanged.
- The token dialog is the only place a credential value enters the client; it moved with the directory, so its `configure` save path is unchanged.

## Testing

- The #310 regression test renders the directory over a real `createSnapshotStore` binding and toggles the provider selection list → detail → list → detail; a conditionally called session hook fails it.
- The two registration faces, the shared store identity, and the single-flighted read are asserted in `apply.client.spec.ts` (both entries over one `ConnectorsSectionController`, list and directory faces distinct, `load` joining).
- The risk-note derivation is covered as a pure function (`risks.client.spec.ts`); the cards' risk lines, the browser/device flow launches (including the rejected-flow swallow and the missing-verification-uri no-op), and the detail's preset-filtered chat list are asserted in `directory.client.spec.tsx`.
- Package client source is at the per-file 100% coverage gate; `pnpm run test:gui` and the repo typecheck pass.

## Related

- [Connectors — provider card grid, per-tab New, and the provider chat list](2026-08-24-connectors-provider-card-grid-and-chat-list.md) — the grid and chat-list decision this note moves to the main area; its per-tab New rule and preset filter survive.
- [Connectors — the chat-screen region](../architecture/2026-08-23-connectors-chat-region.md) — the region and dialog this note re-seats.
- [Connectors P1 — credential references and the preset roster](../architecture/2026-08-23-connectors-cred-refs-and-presets.md) — the secret-free `ConnectorView` the risk notes derive from.
