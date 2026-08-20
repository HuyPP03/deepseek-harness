# Agent Note: `/effort` — switching a session's model reasoning effort

Status: implemented

English | [中文](2026-08-20-effort-command-model-reasoning-switch.zh.md)

## Problem

A session's reasoning effort was reachable only through the model-switch UI: the `selectModel` wire row behind the `/model` popup and the composer seat always pairs an effort with a model choice. There was no textual way to ask "which effort is this session running" or to change the effort without re-selecting the model, and the effective value — the selection's, the model's default, or the provider's — had no reporting surface.

## Decision

The API gateway registers a host command, `effort`, whenever a command registry is composed:

- `/effort` reports the effective effort — the selection's, otherwise the model's `defaultEffort`, otherwise the provider default — with the supported set. A model without reasoning metadata answers `model "<model>" has no selectable reasoning effort` (a success on the bare form, an error on an argued one).
- `/effort <level>` matches an effort id exactly or a name case-insensitively, validates the choice through the same `resolveCallConfig` resolution the `selectModel` RPC uses (an unsupported level is refused before any provider call), updates the process-local selection, and saves the deployment default exactly as the RPC does — a save failure is logged without undoing the session selection.

The command carries no busy gate, unlike `/mode`: an effort is request-header state that a running step never re-reads mid-assembly, and the `selectModel` wire row already switches running sessions. The client's `/effort` popup is a decoration of this host command (registered by `ui-model-selection`): the bare invocation opens the popup over the current model's advertised levels — a `Default` row exists only when the model names no default effort — and an argued line stays the host command's own claim. The popup submits through the same `selectModel` wire row, so the command and the popup are two input faces over one write path rather than two write paths.

## Alternatives considered

- **A dedicated `session.setEffort` RPC.** Rejected. `selectModel` already accepts a complete selection including an effort and owns its validation and default persistence; a second RPC for a value it already carries forks both responsibilities.
- **A client-only command contribution.** Rejected. The effort is Host-owned model-request state; a client-only entry would leave the textual path (`/effort <level>`) unhandled and any non-Web surface that composes a registry with nothing to show.
- **A `/mode`-style busy gate.** Rejected as invented constraint: the one in-flight hazard `/mode` guards against (a recomposition racing a running composition) does not exist for a request-header value no running step re-reads.

## Consequences

- The Web surface is the only one with `/effort`: registration requires a composed command registry, which the CLI does not compose. Effort remains settable through every existing entry where it was settable before; no other surface gains an entry.
- The model-visible ⟺ logged rule holds: the effort reaches a provider request only via the logged `request/header` of the turn that consumes it, and the command logs the standard `command/run`/`command/done` lifecycle pair with no selection payload of its own.
- The effective-effort report reads live metadata (`resolveModelInfo`) at call time, so the command sees catalog changes that postdate a directory load without any refresh.
