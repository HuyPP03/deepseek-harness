# @deepseek-ai/dsh-client-ui-file-inspector

English | [中文](README.zh.md)

The conversation file inspector: the occupant of the `conversation.details.file` seat (declared by `dsh-client-ui-conversation`'s details entry) that opens when the user selects a file — a diff card row, a read row, or a produced-files entry. One panel, up to three seats for the selected file:

- **Preview** — for previewable extensions only: Markdown (`.md`/`.markdown`) renders through the shared `MarkdownText` pipeline over the read text; HTML (`.html`/`.htm`) loads through a sandboxed `<iframe>` (empty sandbox — an opaque origin, so a preview can never run its own scripts or reach the app's storage) pointed at the raw channel's own URL; images and SVG (`.svg` plus the common raster image types) point the `<img>` at the same URL so the browser decodes the bytes without a JS copy; docx (`.docx`) converts through mammoth into the same sandboxed-frame surface (`srcDoc`); and xlsx/csv (`.xlsx`/`.csv`) parse the first sheet through SheetJS into a table of display cells. The tab is the default seat when present and hidden otherwise.
- **Changes** — the latest diff card touching that file in the current window (the settled result view of a write/edit call, top-level or a sub-dispatch of any depth; relative model-facing paths resolve against the session's workspace root), drawn through the shared `DiffBlock` with its gutters, highlighting, and intra-line marks. The tab is hidden when the window holds no diff for the file.
- **Code** — the whole file's verbatim bytes read through the runtime's `fileBytes` service (the host's raw channel, `GET /api/file/<sessionId>/<path>`), virtualized line-by-line (only the visible window is mounted), with line numbers and the shared shiki highlighting; a NUL in the leading 8 KiB switches the seat to a binary notice, and the raw channel's refusals surface as localized states (413 over the 25 MiB bound, 500 unreadable). A pure image file earns no Code tab — its bytes are not a text view.

A second seat reaches files no mutation tool announced: the session file list. The session header's **Files** action (a header-actions occupant, rendered only for a session that records a cwd) opens the details panel on the `conversation.details.files` seat, which lists the session's working set through the `files.list` RPC (the same bounded walk the composer's `@` source fetches: depth 8, 20000 entries scanned, 100 rows, dot entries and the skip list pruned host-side). Directory rows are inert context; a file row reselects that file, so the inspector's normal seats — preview included — take over from the same panel.

The byte read is the runtime service's `read(sessionId, path)` — one fetch per file per session (the service's bounded LRU), shared across concurrent reads, so the inspector never issues a second download for a file the preview or another surface already fetched.

## Model Experience

None, as this package renders already logged session content (diff material) and files served by the raw channel for a human; it alters no model request, tool execution, or session event.

#### KV Cache effect

None. The package is client-only presentation.

## Known Limitations and Deferred Work

- **The Changes tab shows the latest card only** — earlier mutations of the same file in the window are not accumulated; the full per-file history stays with the trajectory view.
- **The office parsers inline into the plugin bundle** — the browser's frozen module table answers `require()` only for its registered module ids, so a code-split sibling chunk cannot load; mammoth and SheetJS therefore ship inside `lib/client.js` (the conversion runs only when an office file is previewed, and the byte read is the same cached one the other seats use).
- **The file list is one bounded snapshot per open** — the `files.list` walk fetches once when the seat mounts (a panel reopen re-fetches; there is no live refresh while the list is open), shows its 100-row window with a truncation note, and offers a local filter over that window rather than host-side queries.
- **The file list has no per-directory navigation** — it shows the walk's flat relative paths for the session's roots; picking a subdirectory is not a separate browse step.
- **The previewed HTML/docx frame's empty sandbox is deliberate** — the frame's opaque origin also prevents the previewed page from reading the app's same-origin storage; a preview that needed more is a security change, not a configuration.
- **Only the first sheet is previewed** — a workbook's other sheets are not surfaced; the grid shows every row of the first sheet as display strings.
