# @deepseek-ai/dsh-client-ui-file-mention

English | [中文](README.zh.md)

Web file-mention source plugin: registers the `@` file source to `ctx.inputTriggers`. Candidates come from the session-addressed `files.list` RPC — the host resolves the session's project cwd and its attached reference projects, filters and ranks them with the live query, and the client never submits a path. Picking a row lands the plain text `@<path> ` in the draft (the plain-text-reference decision: the prompt ships the same literal, and the user message is the session log). The menu shows a short display form — workspace `rel/path`, reference `rootname/rel/path`, a trailing slash for a directory; the pick maps it back to the insertion form through the settled cache, degrading to the display form after a cache clear.

The insertion form is per-root: a main-project entry inserts its workspace-relative path (the model addresses the workspace from its own cwd), a reference entry its canonical absolute path (it lives outside the model cwd, and reads are unrestricted in every confined mode), and a directory appends a trailing slash — a plain-text convention that marks the pick as a folder. The fetch is cached per (session, query) key: the browse key (empty query) keeps a 15-second TTL — the file tree has no change feed, so a short TTL bounds staleness — while a live query re-fetches with a 2-second TTL; a new live query aborts the session's earlier in-flight live fetches. The scope-birth warm prewarms the browse key, a failed fetch never poisons the key, and `connection/reset` clears everything. Subagent scopes list nothing.

## Model Experience

### The `@<path>` mention in the user message

#### What the model sees

A picked mention reaches the ordinary user message as literal `@<path>` text — no dedicated block, no host-side resolution, no prompt section. The model reads it as a file or directory path mention and uses its file tools against it.

#### Token effect

Conditional and append-only: a mention adds its path tokens only to the new user message. Menu browsing and filtering add zero model tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

- **No chip decoration in the draft** — the input machine's text-reference scanner matches word-ish names only (no dots or slashes), so file paths never light up as plain-text references; extending the scanner is an input-machine change.
- **Listing staleness up to the 15-second browse TTL (2 seconds for a live query)** — there is no fs-watch feed; files created, renamed, or deleted settle into the next fetch after the TTL.
- **Bounded walk, silent truncation** — `files.list` walks at most depth 8 and 20000 scanned entries across the roots, returns at most 100 rows, skips every dot-prefixed entry plus the curated directory list in `src/files-skip.json` (node_modules, dependency caches, virtualenvs, build outputs) and symlinks, and reports `truncated` without a menu error tier; the menu caps at 50 rows.
- **Names only, no content search** — the query filters entry names (basename prefix beats path prefix beats substring); nothing reads file contents.
