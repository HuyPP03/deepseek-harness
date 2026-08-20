# Agent Note: `/simplify` and `/code-review` — agent steering and parallel one-shot review

Status: implemented

English | [中文](2026-08-20-agent-actions-simplify-and-code-review.zh.md)

## Problem

After a session has changed code, a human had two questions with no one-line answer. "Make this mess simpler" costs a full model turn of the person's own typing, and the agent only sees the instruction as free text. "Did I break anything / what's worth fixing?" had no answer at all: the model-facing loop is busy with the session's own work, and a human cannot cheaply spawn a second opinion over the files the session touched without writing a prompt.

## Decision

A new host package, `@deepseek-ai/dsh-command-agent-actions`, contributes two no-argument commands to `ctx.commands`, mounted in the `standard` and `code` agent presets (the `chat` preset has no code changes to review or simplify, so it does not mount it). Both settle through the log-only `command/run` / `command/done` pair.

`/simplify` steers the receiving agent with a composed behavior-preserving directive (source `plugin: command-agent-actions`). An idle agent starts a turn; a running agent consumes the steering at its next step boundary, so the command is busy-safe by construction.

`/code-review` derives its scope from the session log alone — the deduplicated `file_path` of every `edit`/`write` tool call, in first-touched order — and starts four one-shot reviewer children in parallel (correctness, security, performance, maintainability) on the `provider` config field's subagent provider (default `spawn`, registered by the host bundles). Each child's prompt is self-contained — the changed file list (capped at 100 paths) plus its single facet and the report-only instruction — because one-shot children must not be assumed to inherit the parent's context. The findings fold into one report: one section per facet in fixed order, a `## failed facets` section for starts that failed, a `(reviewer did not finish: <stop reason>)` marker for incomplete children, and a 32 KiB UTF-8 byte budget with a truncation marker so an oversized review cannot bloat the session log. When the configured provider is not registered, the command degrades to one steering message on the receiving agent and says so in the result; when every facet start fails, the handler rejects and the executor settles the pair as the error. Cancellation is owned by the command executor like every other command; published runs are always disposed.

The report is report-only: no result text instructs edits, and the folded report never enters a model request — it is the human's result card.

## Alternatives considered

- **A single reviewer child (or the main agent) for the whole review.** Smaller, and it inherits the session context for free. Rejected: one long review of four concerns is one long wait and one unfocused answer; the four-facet split is the shape a human actually wants, and the provider's one-shot children run in parallel.
- **Passing the session diff into each child prompt.** Rejected: the log records the final content of `edit`/`write` calls, not a unified diff, so a "diff" would be re-derived by reading files anyway; the file list plus read access gives each child the same information with no log-parsing duplication.
- **A `toolFilter` denying write tools on the reviewer children.** Rejected for now: the report-only instruction is the current contract, and the `toolFilter` capability is not implemented by every registered provider; enforcement is deferred to a deployment that needs it (README limitation).
- **Mounting the commands on the `chat` preset.** Rejected: a chat session has no recorded code changes, so both commands would only ever answer "nothing to do".

## Consequences

- Both commands are host commands: they appear on every command adapter composing a preset that mounts them (CLI and Web alike).
- The result text never enters a model request; the only model-visible output of the main `/code-review` path is the four children's own prompts and turns, on the provider's side.
- The review scope is edit/write-only by construction: files changed through `bash` are invisible to it (README limitation), and the scope is as-of-log — a review covers what the session's log records, not the working tree.
- The four-facet prompt and the 100-path / 32 KiB bounds are protocol constants, not deployment config; the only deployment-varying choice is the provider name.
- The active-set / drain / register lifecycle mirrors `command-compact` and `command-search` (jscpd-marked); a shared command-lifecycle helper across the three packages is the obvious later simplification.
