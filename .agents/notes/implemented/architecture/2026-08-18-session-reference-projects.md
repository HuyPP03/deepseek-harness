# Agent Note: Session reference projects — comparison projects attached to a session

Status: implemented

English | [中文](2026-08-18-session-reference-projects.zh.md)

## Problem

A user working on one project often needs to compare against one or two sibling projects — an upstream repository, a library the project embeds, a parallel checkout. A session is anchored to exactly one directory: `SessionHeader.cwd` is the session workspace, the workspace registry records which sessions belong to which project, and the model sees nothing about any other project directory. A session's **reference projects** — the set of attached comparison directories, never including the session workspace — is a log-level fact owned by [@deepseek-ai/dsh-workspace-references](../../../../packages/workspace/workspace-references/README.md) (`ctx.workspaceReferences`), a member of the workspace family.

## Decision

- **Whole-value events.** Every change appends one `workspace/references` event carrying the full canonical path list; the last event in the log is the attached set, and an empty list detaches all. This follows the `sandbox/mode` precedent: one event per change, no start/update/result family, log-only (no `surfaceOp`, no Conversation Node), with a companion invariant that checks every recorded path is absolute, non-empty, and never equal to the session's own `header.cwd`.
- **The cap is a config field, not a constant.** `Config.maxReferences` (default 2, minimum 1) bounds the reference list; the session workspace does not count, so a default deployment compares the main project with at most two others. The API gateway exposes the bound on the wire as `REFERENCE_PROJECTS_MAX` (2); the UI reads the live bound from the `workspaceReferences` projection, so a raised deployment needs no client change.
- **Writability follows the standing sandbox, not a new check.** Every confined sandbox backend already allows reads outside the session workspace, so admitted reference directories are readable as-is in every mode; making them writable is a sandbox-vocabulary decision, not a package one. The `workspace-refs-write` mode ([the sandbox note](../feature/2026-07-06-sandbox.md), the base bundle's `write-workspace` preset — 'Write All') adds the attached reference roots to the writable set: `resolve()` carries them as `referenceRoots`, which only that mode consumes, `writableRoots` folds them into the shared allow-list, and every backend grants them alongside the workspace root.
- **The model sees references through one prompt section.** `workspace:references` (order 115, after `sandbox:policy`) renders a pinned intro line plus one path line per reference, and renders empty with no references. No new tools: the model reads references with the file tools it already has.
- **Surfaces.** The API gateway accepts `referenceWorkspaceIds` on `session.create` (wire-validated to the cap; the first selected workspace remains the session's main project) and offers a whole-value `session.setReferences` RPC for mid-session attach and detach. ACP `session/new` maps `additionalDirectories` onto the same service when the package is mounted and rejects with `invalidParams` otherwise. The client projection key `workspaceReferences` (view: path list plus bound) feeds the Web UI picker and the session-header reference chip; a plain chat — a session with no project at all — is admitted and runs in the host cwd.

Forks inherit references with their seed; subagent children do not (a child runs in its own workspace, and comparing a child against its parent's references needs a contract this design does not offer).

## Testing

- The apiproxy specs cover `session.create` with two reference ids — one `workspace/references` event in the log and the `workspace:references` section in the first model request — a third id rejected on the wire, and an id naming the session's own workspace rejected with `references-invalid`; `session.setReferences` replaces the set whole-value, an empty list clears it, and an unmounted deployment rejects with `references-unsupported`.
- The ACP specs cover `session/new` accepting one to two `additionalDirectories` where the package is mounted and rejecting three, relative, or self-cwd entries with `invalidParams`; an unmounted deployment rejects with the unmounted message.
- The keyless ACP snapshot scenarios (`examples/acp-agent`, `reference-directories`, `reference-refs-write` under `workspace-refs-write`, and the `reject-extra-dirs` denial pair) replay the full surface: the event in the session log, the policy- and reference-aware prompt section in the request header, and a successful write into the attached reference project.
- The Web `multi-workspace-session.e2e.ts` covers the picker (one main project plus up to two reference projects, plain chat) and the session-header chip attaching and detaching references within the projected bound.

## Alternatives considered

- **Workspace registry membership (multi-project sessions).** Rejected: the registry's records are UI bookkeeping, invisible to models by design, and not session log events — comparison context could not become model-visible without a second redundant fact. Membership and references stay orthogonal: a session is filed under its main project whatever it references.
- **`workspace/references/add` / `remove` event pair.** Rejected: two events per change plus a fold is exactly the start/update/result family the whole-value `sandbox/mode` precedent avoids; whole-value lets the invariant check the cap and the self-cwd exclusion per event.
- **Dedicated reference-reading tools.** Rejected: the file tools already read the whole sandbox-allowed filesystem; dedicated tools would duplicate them and give the model a second vocabulary for the same access.
- **Prompt-context-only implementation (no events).** Rejected by the model-visible ⟺ logged rule: the section must rebuild identically from the log on resume, fork, and replay.

## Consequences

- **`workspace-refs-write` and `danger-full-access` lift the references' read-only guarantee**, exactly as they lift the session workspace's; the prompt text now tells the model to modify references only when the current file policy allows. Accepted: each deployment's policy statement already announces the lifted limit.
- **Reference directories can go stale.** A reference project may be deleted or moved after attach; the model then sees `ENOENT`-style tool results. Accepted: the session workspace has the same property, and re-attaching after a move is one RPC.
- **Each reference costs one path line plus the pinned intro per prompt request**, bounded by the default cap and small against the comparison context it buys.
- **The registry stays unaware of references.** A referencing session is still filed under its main project only; a workspace's session list does not show inbound references. Deliberate: the registry is a filing ledger, not comparison context.
