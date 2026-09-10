# Agent Note: Open Harness details, file inspector, and terminal chrome

Status: implemented

English | [中文](2026-09-10-open-harness-details-terminal-chrome.zh.md)

## Problem

After the Chats / Workspaces / Connectors dashboards gained a denser card layout and brand-red accent, the right details column still read as a sparse Figma draft: a thin header with an inline close glyph, flat empty copy, and padded wrappers around seats that already scroll. The file inspector tab strip and session file list looked like a prototype list; the job log and terminal banner did not share the same surface family as CodeBlock / TerminalBlock.

## Decision

Polish the details column as an IDE inspector without changing selection or seat routing:

- DetailsPanel uses a layered header, `IconCloseOutline16`, a muted full-path subtitle on file selections, a dashed empty card that keeps the existing `details.empty` copy, and a zero-padding `seatBody` for file / browse / job occupants so those seats fill the column.
- FileInspector tabs get a clearer brand-red underline and hover wash; loading / empty states become dashed cards; the code gutter separates more strongly; FileBrowser rows lead with folder / document icons and a search-affordance filter field.
- TerminalBlock keeps its prompt / copy / height-cap contracts and only retints the banner and copy hover toward the business-primary wash.
- JobDetailPanel's status line and log adopt the same banner + code-block family so a background job log reads like terminal output inside the details seat.
- AppFrame's details column no longer paints a second left border; DetailsPanel owns the seam.
- InputBar's send / stop controls use the shared `IconSendOutline16` / `IconStopFill16` atoms instead of inline SVGs.

## Alternatives considered

**Rewrite DetailsPanel empty copy and add a second hint line.** Rejected: several specs assert the current `details.empty` strings; chrome can improve without moving product copy.

**Extract a shared "inspector chrome" React primitive across conversation, file-inspector, and jobs.** Rejected: the slot system forbids cross-package component imports, and the three seats differ (tool sections vs tabs vs job log). Shared look stays token + CSS Module rhythm.

**Restyle TerminalBlock geometry (gutter, radius, or prompt layout).** Rejected: tests and tool cards depend on the existing class and layout contracts; a banner wash is enough to align with the red accent refresh.

## Consequences

- Opening a file, session file list, tool call, or background job in the right column presents a denser inspector that matches the dashboard accent language.
- File / browse / job seats fill the details body; tool Input / Output sections keep their padded layout.
- Terminal and job-log surfaces share a red-tinted banner wash without changing copy, ANSI, or height-cap behavior.
- Product-visible `details.empty` strings are unchanged.

## Related

- [Open Harness dashboards, dark palette, and brand-red accent](2026-09-10-open-harness-dashboard-and-red-accent.md) — the accent and dashboard refresh this chrome follows.
- [Web styling system](../process/2026-07-19-web-styling-system.md) — token ownership and the no-literal-color rule.
