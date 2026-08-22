# Agent Note: the Web file inspector — preview, diff, and code seats over one raw channel

Status: implemented

English | [中文](2026-08-22-web-file-inspector-and-chat-sandbox.zh.md)

## Problem

The Web conversation showed file work as opaque text: a `write`/`edit` result was a `<path>…</path>` envelope, a `read` result was line-numbered text, and nothing let a user see the file itself. There was no rendered preview (Markdown/HTML/image/Office documents), no changed-lines view for a mutation, and no way to inspect a file a chat had produced — a workspace-less chat session ran in the host's process directory, so its artifacts scattered wherever the server was launched.

## Decision

`@deepseek-ai/dsh-client-ui-file-inspector` owns a details column (a 480 px AppFrame grid track) with three seats for the selected file: **Preview** (the default where available), **Changes** (the applied diff of a `write`/`edit` call), and **Code** (a virtualized view over bounded bytes). One selection channel drives it: `SelectionTarget` carries a `callId` (a tool row opens its diff), a `filePath` (a file row's path link opens the file, resolved host-side against the session cwd), or a `browse` directory (the session file list).

The file bytes flow through one seam, `fileBytes` (host) and its raw channel (carrier): the same containment proof that gates `files.read` (lexical + symlink-resolved, inside the session cwd or an attached reference) gates `GET /api/file/<sessionId>/<path>`, which streams verbatim bytes under the 25 MiB bound with a curated content type and `nosniff`. The preview seats point their elements at that URL — the browser decodes images and loads HTML/docx in a sandboxed frame (empty `sandbox` attribute: an opaque origin, so a preview can never run its own scripts or reach the app's storage) — and the office parsers (mammoth for docx, SheetJS for xlsx/csv) run in the browser over the LRU-cached read, so a preview never triggers a second download.

Two bundle constraints shaped the client build: the browser module table answers `require()` only for its registered ids, so the plugin build disables code splitting (a sibling chunk's `require("./chunk-*.cjs")` would miss the table at load) and the parsers inline into the single `lib/client.js`; and xlsx probes `typeof require` — true inside a bundled CJS factory — and takes its node-only `require('stream')` branch, so the client build aliases `stream` to an empty stub.

A workspace-less chat session (a `sessions.create` carrying neither workspace nor cwd) now lands in its own sandbox `<harness home>/chat/<sessionId>`: the gateway passes a `chatCwdFor` default to `createApiProxy`, an explicit cwd or a workspace still wins, and the sandbox sits inside the session cwd so the inspector's channels serve the files a chat creates.

The produced-files surface derives from mutation tools only — a file a shell command creates announces nothing, so it had no inspector entry point. The fix is a browse mode, not a new announcement channel: the session header's **Files** action (a `conversation.session.header.actions` occupant, rendered only for a session that records a cwd) opens the details panel on the `conversation.details.files` seat, which lists the session's working set through the existing `files.list` RPC (the bounded walk the composer's `@` source shares; no host change). A listed row reselects that file, so the normal seats take over. Cross-plugin, the gesture rides the `detailsPanel` service ui-conversation provides (`open(sessionId, target)` / `close`), which bridges to the details entry's bound actions captured in its registration inject — per-session stores are not shareable across plugins, so the service is the only sanctioned route.

## Alternatives considered

- **Server-side rendering for previews** (markdown/Office converted on the host). Rejected: it duplicates the client's Markdown renderer, blocks browser-native image decoding, and adds host work per view; the raw channel keeps the host a byte server.
- **A split parser chunk fetched at first preview.** Rejected: the frozen module table cannot answer sibling-chunk requires (the boot screen fails to load the plugin); inlining trades ~2 MB of bundle size for a loadable bundle.
- **`allow-same-origin` on the preview frame.** Rejected: a same-origin preview could read the app's storage; the opaque origin is the isolation the feature needs.
- **A `Config` field for the chat sandbox location.** Rejected: the harness home is the environment-level root and `chat/` is a layout constant beside `.mcp/`; there is no deployment-varying choice to expose.
- **E2E seeds recorded from real model turns.** Rejected: the Web e2e lane is keyless and deterministic; the seeds are committed fixtures with the real event envelopes.

## Consequences

- The inspector's plugin bundle is heavy (parsers inlined); the cost is paid at plugin load, not at first preview. A module table that can answer chunk requires would let the split return.
- The file list is one bounded snapshot per open (100 rows, truncation note, local filter; no live refresh) and has no per-directory navigation — the walk's flat relative paths are the whole browse.
- Chat sandboxes accumulate under the harness home. They are not session artifacts (logs live in the persistence root); cleanup is deferred.
- The TUI keeps the plain diff card; the line-aligned body with gutters, per-language highlighting, and intra-line marks is the Web projection.
- Files above 25 MiB answer 413 at the raw channel and unmapped extensions serve `application/octet-stream`; the seats degrade to the Code seat or a download.
- Coverage: the preview seats (including docx/xlsx/csv and the failure state) are unit-tested on committed fixtures; the e2e proves the seats end-to-end (raw-channel requests captured, sandboxed frames asserted), the chat scenario asserts the real host fallback in-process through the scaffold's live context, and the Files button scenario proves header action → file list → row click → inspector preview against the chat sandbox.
