# Agent Note: Web File Mentions (the @ Source Over files.list)

Status: implemented

English | [中文](2026-08-19-web-file-mentions.zh.md)

## Problem

A user referencing a file in the composer had no way to pick it: the `@` trigger carried only the subagent source, and typing a path by hand is error-prone and unresolvable when the file sits in an attached reference project outside the session cwd. The model needs a path it can hand to its file tools, and the path form must differ per root — workspace-relative for the main project, absolute for a reference.

## Decision

A new `files` RPC domain (session-addressed, `files.list`) plus a new client plugin `ui-file-mention` that registers the `@` `files` source on the existing input-trigger pipeline.

- **Host side** — `packages/host/apiproxy`: `files.list({ sessionId })` resolves the session's working set host-side — `session.header.cwd` plus `referencesOf(session)` (the reference set folded from the session log) — and walks it with the wire contract's fixed bounds: depth 8, 1000 files across all roots, files-only, skipping dot-prefixed entries and `node_modules`, never following symlinks (loop safety; a dangling link names no working-set file). The bounds are protocol constants of the contract, not deployment tunables. The walk is metadata-only (no file contents) and runs in the host process, outside the agent sandbox. A vanished or unreadable root contributes nothing rather than failing the listing; `truncated` reports the entry bound.
- **Wire** — `FileEntry { path, relative, root }` with `root` = `'workspace'` or the reference basename; session-addressed like `skill.list` (the client never submits a path; no Agent is created or resumed).
- **Client side** — `packages/client/ui-file-mention` (browser half only): one source, `trigger: '@', name: 'files'`. Candidates filter the settled listing client-side (case-insensitive: basename-prefix < path-prefix < substring; menu capped at 50 rows). The menu shows the short display form — workspace `rel/path`, reference `rootname/rel/path`; `onPick` maps the row back to the **insertion form** through the per-session settled cache and lands the plain text `@<path> `: workspace-relative for the main project (the model addresses the workspace from its own cwd), canonical absolute for a reference (outside the model cwd; reads are unrestricted in every confined mode). A cleared cache degrades to the display form.
- **Cache** — one in-flight fetch per session with a 15-second TTL: the file tree has no change feed, so a short TTL bounds staleness. Scope-birth warm prewarms the key; a failed fetch never poisons the key; `connection/reset` clears everything. Subagent scopes list nothing.
- **Menu title** — the `files` key in the pipeline's existing `slash.menu` locale namespace (`Files` / `文件`); the group title lookup is open-ended by source name.

## Consequences

- A picked mention reaches the model as literal `@<path>` text inside the ordinary user message — the plain-text-reference decision ([web input machine and slash pipeline](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)): no dedicated block, no host-side resolution, no new session event, no prompt section, no `SESSION_FORMAT_VERSION` movement; the message is the log, so model-visible ⟺ logged holds on the existing surface.
- The `files.list` walk is host-side and metadata-only: it exposes directory names (never contents) to the browser, and the dot-entry skip keeps secret files (`.env` and kin) out of the mention picker.
- The web GUI gains a third trigger source group; the fixture API client serves a static three-row working set for offline acceptance.
- Known limitations: no chip decoration (the input machine's text-reference scanner matches word-ish names only — no dots or slashes — so paths never light up; extending the scanner is an input-machine change), up-to-15-second listing staleness, silent walk truncation (no menu error tier), files only (no directories, no content search).

## Alternatives considered

- **Reuse `host.listDirectory`**: it is a single-level browser listing where the client submits raw paths under the `browse` capability — the opposite posture of a session-scoped mention source, and a depth-8 tree would cost many sequential round trips.
- **`ReferenceInsert` chip with a codec**: chips give a styled occurrence, but the plain-text path is the skill-source precedent, needs no codec, and survives replay as ordinary message text.
- **Chip decoration via the source lexicon**: the text-reference scanner's name pattern (`[\\w-]+`) cannot match file paths, so a lexicon roll would never light; implementing one now would be dead weight (the known limitation records the follow-up).
