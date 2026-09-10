# Agent Note: Open Harness dashboards, dark palette, and brand-red accent

Status: implemented

English | [中文](2026-09-10-open-harness-dashboard-and-red-accent.zh.md)

## Problem

The dark theme used a cool-graphite base with a teal accent (info buttons, business state, user-message bubble, sidebar active accent, and the Thinking-status text gradient). That teal split the product identity from the brand-red scale the light theme already uses, and the Chats / Workspaces / Connectors full-column dashboards were sparse: a flat list or a low-contrast card grid, a title-only header, and a connector sidebar empty state that filled the column like a page.

## Decision

Dark mode keeps the cool-graphite surface scale (`--oh-static-cool-50..950`) and retints every brand/business alias to the existing `--oh-static-brand-*` red: info buttons, `--oh-alias-state-business-primary` / `tertiary`, user-message bubble + highlight, and the sidebar active-item accent. The teal static tokens are gone. Hover/active washes in dark mix brand red instead of a flat white overlay. The Thinking-status gradient already reads `--oh-alias-state-business-primary`, so it follows the red alias with no component change.

The three dashboards share one page layout: a centered inner measure (`min(1120px, 100%)`), a title + lede + count (or CTA) header, and a responsive card grid. Chats cards carry an accent-tinted glyph, title, workspace chip, and relative time. Workspace cards are equal-height folder tiles (glyph, title, path, session-count chip). Connector directory cards keep their actions and risk notes but match that card chrome; the directory header's New connector control is the same primary-plus CTA as New Chat (default size, leading plus icon, roster-count chip); the sidebar connected-providers list is a compact status column (short empty copy, not a centered page).

The Connectors tab also gets a New control in the left sidebar, in sync with the Chats (New Chat) and Workspaces (New Session) tabs: the sidebar's tab-following New button now shows on every tab and opens the New Connector dialog on the connectors tab — the same dialog the directory header drives. Because the sidebar shell (ui-sidebar) cannot import the connectors controller (ui-connectors), the dialog is exposed as a `connectorNew` provided command that the sidebar reads at call time, so apply order between the two packages stays unconstrained.

New copy keys (`dashboard.subtitle`, `workspaces.subtitle`, `directory.subtitle`, `directory.count.*`, empty-state hints) live in the owning locale dictionaries; the sidebar's `connector.new` label lives in the sidebar dictionary.

## Alternatives considered

**Revert dark surfaces to the warm-graphite (`--oh-static-neutral-warm-*`) base as well as the red accent.** Rejected: the cool graphite still separates Open Harness dark from the prior warm near-black, and the complaint was the teal accent and the sparse dashboards, not cool surfaces themselves.

**Keep teal as a secondary accent and use red only on the Thinking gradient.** Rejected: a second accent recreates the split identity; the business-primary alias already drives the gradient, state dots, and tab chrome, so one red mapping covers them.

**A shared dashboard React primitive across the three packages.** Rejected: the slot system forbids cross-package component imports, and the three grids differ (chat recency vs workspace folder vs connector actions). Shared look is token + CSS Module rhythm, not a new public component.

## Consequences

- Dark accent, Thinking-status gradient, info buttons, user bubbles, and the header's active tab all ride brand red; light mode is unchanged.
- Chats, Workspaces, and Connectors dashboards present as card pages with a lede; Connectors' New connector control matches the Chats New Chat CTA; the connector sidebar stays a compact connected-provider list.
- The left sidebar shows a New control on every tab: New Chat (Chats), New Session (Workspaces), and New Connector (Connectors, opening the directory's dialog through the `connectorNew` command).
- Empty-state and subtitle copy is localized in `en` / `vi` / `zh` of the owning packages.
- Cool-graphite static tokens remain for dark surfaces; no feature CSS names a teal token.

## Related

- [Web styling system](../process/2026-07-19-web-styling-system.md) — token ownership and the no-literal-color rule this change follows.
- [Connectors — provider card grid, per-tab New, and the provider chat list](2026-08-24-connectors-provider-card-grid-and-chat-list.md) — the directory grid this layout restyles.
