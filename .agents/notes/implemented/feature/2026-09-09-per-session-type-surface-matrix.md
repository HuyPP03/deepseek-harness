# Agent Note: per-session-type surface matrix

Status: implemented

English | [中文](2026-09-09-per-session-type-surface-matrix.zh.md)

## Problem

Slash-menu rows, the reference-project chip, the mode seat, and the permission preset were each gated ad hoc per session type: chat sessions hid `/permission` and refused the switch; provider (connector) chats hid `providerHidden` rows but still showed `/mode` and could be switched into or out of their fixed provider preset; the reference chip showed for every session after the eligibility work that preceded this matrix. The pieces disagreed about which surfaces are fixed for a session, so a connector chat offered a mode switch its own mode was not one of, and a plain chat could not be told apart from a provider chat by anything the menu showed.

## Decision

One matrix, one authority per surface. Session types: **chat** (a `chatPresetIds` preset), **workspace** (owned by a registered workspace), **provider/connector** (its agent preset is claimed by the composed connectors service, read through `ctx.get('connectors').presetIds()` where a host gate needs it and through the `connectorPresetIds` client provide where a menu gate needs it). A provider session is never a chat or a workspace; the checks run in that order.

| Surface | Chat | Workspace | Provider |
| --- | --- | --- | --- |
| Reference chip + `setReferences` | hidden, `references-unavailable` | shown | shown |
| `/mode` menu row | hidden | shown | hidden |
| `/mode` host guard | refuses across `chatPresetIds` | — | refuses into/out of any claimed provider preset; the bare roster lists neither chat nor provider presets |
| `/permission` menu row | hidden | shown | hidden |
| Permission preset | pinned read-only at creation, switch refused | user-switchable | pinned read-only at creation, switch refused |
| Mode seat (hero) | offered | offered | filtered out |

- `agent-presets` `switchModeCommand` gained the provider guard (the same shape as the chat guard: current or target in the claimed set refuses) and the no-arg roster now lists only switchable presets.
- `permission-presets` pins a fresh provider session to the configured chat preset (read-only by default) and refuses the `/permission` switch while it runs a claimed preset.
- `ui-commands` hides the `/mode` row for chat and provider sessions and the `/permission` row for both.
- The host reference gate and the chip eligibility rule belong to the reference-eligibility note next door (its `2026-09-08-` dated file in this directory); the hero seat already filtered provider presets before this matrix.

## Alternatives considered

**A dedicated `providerHidden` flag per row, as with the existing flag.** It would grow one more flag per new fixed surface and let flags disagree with the host guards; the matrix centralizes the judgment on the session type, and the existing `providerHidden` flag stays for rows a provider chat genuinely lacks (code-workspace tools) rather than rows it is merely fixed on.

**Composing provider presets out of the roster entirely.** Their sessions still report their current preset and the roster is a composition fact, not a menu fact; refusing the switch is the right place to enforce the fix.

## Testing

- `dsh-agent-presets` mode spec: switch into and out of a provider preset refuses; the bare roster omits chat and provider presets.
- `dsh-permission-presets` spec: a fresh provider session pins read-only; a preset no connector claims keeps the user default; the `/permission` switch refuses on a claimed preset.
- `ui-commands` service spec: `/mode` and `/permission` rows hide for both fixed surfaces and stay for ordinary sessions.
- `pnpm run test:gui` green; `DSH_SNAPSHOT=replay pnpm run test:web` confirms the assembled e2e scenarios.

## Consequences

- A connector chat presents as fully fixed — mode, permission, and its provider tools — while still carrying the reference chip, so its fixedness never reads as a missing capability.
- The matrix has no new wire fields: session types resolve from facts already on the wire (the header `agentPreset`, the connectors roster), so nothing changes for ACP or the SDK projections.
- A future fixed surface adds one column entry, one host guard, and one menu-row rule; the three sites are the same table row.
