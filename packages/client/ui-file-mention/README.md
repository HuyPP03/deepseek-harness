# @deepseek-ai/dsh-client-ui-file-mention

English | [中文](README.zh.md)

Web file-mention source plugin: registers the `@` file source to `ctx.inputTriggers`. Candidates come from the session-addressed `files.list` RPC — the host resolves the session's project cwd and its attached reference projects, the client never submits a path. Picking a row lands the plain text `@<path> ` in the draft (the plain-text-reference decision: the prompt ships the same literal, and the user message is the session log). The menu shows a short display form — workspace `rel/path`, reference `rootname/rel/path`; the pick maps it back to the insertion form through the per-session settled cache, degrading to the display form after a cache clear.

The insertion form is per-root: a main-project file inserts its workspace-relative path (the model addresses the workspace from its own cwd), a reference file its canonical absolute path (it lives outside the model cwd, and reads are unrestricted in every confined mode). The fetch is cached per session as one in-flight promise with a 15-second TTL — the file tree has no change feed, so a short TTL bounds staleness — the scope-birth warm prewarms the session key, a failed fetch never poisons the key, and `connection/reset` clears everything. Subagent scopes list nothing.

## Model Experience

### The `@<path>` mention in the user message

#### What the model sees

A picked mention reaches the ordinary user message as literal `@<path>` text — no dedicated block, no host-side resolution, no prompt section. The model reads it as a file path mention and uses its file tools against it.

#### Token effect

Conditional and append-only: a mention adds its path tokens only to the new user message. Menu browsing and filtering add zero model tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

- **No chip decoration in the draft** — the input machine's text-reference scanner matches word-ish names only (no dots or slashes), so file paths never light up as plain-text references; extending the scanner is an input-machine change.
- **Listing staleness up to the 15-second TTL** — there is no fs-watch feed; files created, renamed, or deleted settle into the next fetch after the TTL.
- **Bounded walk, silent truncation** — `files.list` walks at most depth 8 and 1000 files across the roots, skips dot-prefixed entries, `node_modules`, and symlinks, and reports `truncated` without a menu error tier; the menu caps at 50 rows.
- **Files only** — directories are not mentionable, and the query is a case-insensitive substring filter (no content search, no fuzzy ranking beyond prefix tiers).
