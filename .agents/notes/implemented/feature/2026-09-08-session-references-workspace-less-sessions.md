# Agent Note: reference projects for workspace-less sessions

Status: implemented

English | [中文](2026-09-08-session-references-workspace-less-sessions.zh.md)

## Problem

Attaching reference projects was restricted to sessions that belong to a workspace: both gateway entry points (`session.create` with `referenceWorkspaceIds`, `session.setReferences`) refused a non-empty set for a workspace-less session with `references-require-workspace`, and the session-header reference chip hid itself for the same sessions. Connector (provider) sessions are exactly workspace-less sessions, so a user asking for a Confluence chat to read local folders alongside the connector data had no path: the chip was absent and a direct call rejected. The first cut of this change admitted references on every session; the session-type surface matrix that followed refined the rule: a plain chat has no project to reference either, so it stays out.

## Decision

References are valid for two kinds of session:

- A session that a registered workspace owns (the workspace's own chat) may reference other registered workspaces.
- A session running a provider preset — a preset id the composed connectors service claims (`presetIds()`) — may reference any registered workspace, because the connector's fixed mode is the session's project surface.
- Every other session (a plain chat) is refused with `references-unavailable` at both gateway entry points; the service-level validation (existing directories, never the session's own cwd, the `maxReferences` cap) remains the single enforcement point for the shapes that are admitted, and the empty whole value stays the idempotent detach-all no-op.
- The client chip's hide rule mirrors the host: the chip shows only while the `workspaceReferences` projection is composed and the session is workspace-owned or provider; its menu lists every registered workspace except the session's own (a non-owned session has no own row to exclude).
- The replaced `references-require-workspace` code leaves the RPC error map, the wire schema, and the generated cordis API catalog; `references-unavailable` takes its place.

## Alternatives considered

**References on any session (the intermediate rule).** One source of truth (the capability's composition) and no data crossing; it shipped in this same pre-release window before the surface matrix landed. It gave a plain chat a project surface it has no name for — its mode is not fixed to anything, so a reference set there has no home.

**A separate add-folder control on the connector detail surface.** It would duplicate the chip, the whole-value verb, and the menu for a second surface; the connector chat is a normal conversation whose header already carries the chip's slot.

## Testing

- `dsh-apiproxy`: a create with references and no workspace is admitted only when the session runs a provider preset and logs one whole-value `workspace/references` event; a plain chat is refused with `references-unavailable` and commits no agent. `setReferences` mirrors both directions. The unmounted-deployment and self-cwd denials are unchanged.
- `dsh-connectors`: the claimed preset ids publish over catalog and custom connectors (`presetIds()`).
- The client chip spec: a plain chat renders nothing; a non-claimed preset renders nothing; a provider session renders the trigger and lists every registered workspace; workspace-owned sessions are unchanged.
- `pnpm run test:gui` green; `DSH_SNAPSHOT=replay pnpm run test:web` confirms the assembled e2e scenarios.

## Consequences

- The reference chip appears in workspace session headers and connector chat headers while the capability is composed; plain chats hide it, and a typed or scripted reference call on one gets `references-unavailable`.
- The hero picker's multi-select is unchanged: the first checked project is main, plain chat stays the empty check set.
- [Session reference projects](../architecture/2026-08-18-session-reference-projects.md) keeps owning the event, the cap, and the prompt section; the per-session-type surface-matrix note next door (its `2026-09-09-` dated file in this directory) owns the fixed surfaces this rule belongs to.
