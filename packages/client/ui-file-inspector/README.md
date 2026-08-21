# @deepseek-ai/dsh-client-ui-file-inspector

English | [中文](README.zh.md)

The conversation file inspector: the occupant of the `conversation.details.file` seat (declared by `dsh-client-ui-conversation`'s details entry) that opens when the user selects a file — a diff card row or a produced-files entry. One panel, two seats for the selected file:

- **Changes** — the latest diff card touching that file in the current window (the settled result view of a write/edit call, top-level or a sub-dispatch of any depth; relative model-facing paths resolve against the session's workspace root), drawn through the shared `DiffBlock` with its gutters, highlighting, and intra-line marks. The tab is hidden when the window holds no diff for the file.
- **Code** — the whole file's verbatim bytes read through the runtime's `fileBytes` service (the host's raw channel, `GET /api/file/<sessionId>/<path>`), virtualized line-by-line (only the visible window is mounted), with line numbers and the shared shiki highlighting; a NUL in the leading 8 KiB switches the seat to a binary notice, and the raw channel's refusals surface as localized states (413 over the 25 MiB bound, 500 unreadable).

The byte read is the runtime service's `read(sessionId, path)` — one fetch per file per session (the service's bounded LRU), shared across concurrent reads, so the inspector never issues a second download for a file the preview or another surface already fetched.

## Model Experience

None — the inspector renders existing session content (diff cards) and existing files (raw channel); it adds no model-visible content and changes no prompt.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **The Changes tab shows the latest card only** — earlier mutations of the same file in the window are not accumulated; the full per-file history stays with the trajectory view.
- **Binary and oversized files have no preview yet** — the Code seat notices them; document previews (markdown/html/image, then docx/xlsx) are a follow-up that reads the same raw channel.
