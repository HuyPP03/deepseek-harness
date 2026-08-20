# Agent Note: `/mode` — switching a session's preset mid-conversation

Status: implemented

English | [中文](2026-08-20-mode-mid-conversation-preset-switch.zh.md)

## Problem

A session was locked to the preset it was created with. The `agentPresets.select` RPC is the only switch, and it is blank-only: the gateway answers `agent-preset-locked` once the session produced anything, because the RPC surfaced the composer seat, where a blank session is the only state the seat can still change. A user mid-conversation had no way to move between the roster's presets — to drop into a coding preset from a general one, or back out — without starting a new session and losing the conversation.

## Decision

The `AgentPresets` service registers a host command, `mode`, on the command registry whenever one is composed:

- `/mode` reports the session's current preset and the full roster.
- `/mode <preset>` re-links the session to that preset's standing composition through the existing `recompose()`, then appends the same `agent-preset/selected` event the blank seat flow records, so a resume or fork rebuilds the switched composition.

The command carries two gates, and `recompose()` itself remains caller-gated:

- **Idle.** A running turn owns its composition for the duration of its steps. The handler refuses while `agent.status` is `running`, and the switch re-reads that state under a per-session lock, because a turn may have started between the request and the re-link. Concurrent switches on one session serialize through that lock; the last caller wins.
- **Chat presets.** A new `chatPresetIds` config field names presets a session is created ONTO that `/mode` never crosses in either direction. A chat session is a fixed conversation surface, not a mode; the web deployment pins `chat` the way it pins the read-only permission preset.

Mid-conversation history is inert: logged tool calls the new catalog cannot make stay in the log exactly as a mid-conversation model switch leaves them. The command records no input of its own — the `agent-preset/selected` event owns the payload (`recordInput: false`).

The `agentPresets.select` RPC is unchanged: still blank-only, still the seat flow's gate.

## Alternatives considered

- **Widen the RPC to started sessions.** Rejected. The RPC's contract is the seat's: a blank session the user has not yet started. A second, mid-conversation write path with different guards is a command, and commands already own user-initiated actions on a live session.
- **A separate "mode" concept mapped onto presets.** Rejected. A mode IS a preset — the roster, the composition, and the switch mechanism are identical; a parallel vocabulary would name the same thing twice and let the two drift.
- **Block switching entirely (status quo).** Rejected as the user-facing answer; the refusal was a wire-contract artifact of the blank seat, not a statement that started sessions must be immutable.

## Consequences

- A started session's composition can change under it, so every reconstruction path already resolves the running preset (`resolveSessionPreset`) rather than reading the header; nothing new is required there.
- The model-visible ⟺ logged rule holds because the switch commits the `agent-preset/selected` event after the re-link, and the command appends no other payload.
- `chatPresetIds` is deployment-shaped: the guard is only as strong as the configuration. A surface that does not configure it (the CLI) switches chat sessions freely; the web surface pins `chat`.
- The client menu entry (a bare `/mode` popup over the roster) lands with the slash-tool UI work, not this command.
