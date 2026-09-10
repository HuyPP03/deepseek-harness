# Agent Note: Open Harness stroke icon family

Status: implemented

English | [中文](2026-09-10-open-harness-stroke-icon-family.zh.md)

## Problem

The `ui-primitives` icon set was a grab-bag of Figma fill-path extracts (a deepsuite batch plus harness-only figma extracts), each a different visual weight: solid filled shapes, some with 20% inner fills, and a masked goal glyph. After the brand-red dashboard refresh the mixed filled glyphs read heavier than the surrounding line-drawn chrome (buttons, cards, borders) and split the product's visual identity.

## Decision

Redraw every glyph as one stroke family: a single 1.5px `currentColor` stroke with round caps and joins, each on its own native viewBox, so the whole set reads at one line weight at any size. A shared `Frame` (stroke) and `FillFrame` (filled) helper carries the common svg attributes; each icon supplies only its inner geometry.

- The filled glyphs keep their `currentColor` fills: the `*Fill` variants (Stop, Like, Dislike, TriangleRight, Close), `Sparkle16`, and the duotone `FolderOpen16` (a 25%-opacity back panel over the outline).
- Names, default drawn sizes, and the `IconProps` `{size, className}` contract are unchanged; color still rides `currentColor` and no glyph hardcodes a palette.
- No glyph uses a document-global `id` or `clip-path`, so instances compose freely (the previous masked goal glyph is now plain concentric rings).
- The set is 78 glyphs: the 69 that predated the dashboard refresh plus the nine added during it (the three 18px dashboard heroes, the stats chart, the custom subagent, and the four file-type marks), all redrawn in the same stroke language.

## Alternatives considered

**Tint the existing Figma fills toward the red accent instead of redrawing.** Rejected: the complaint was the mixed fill weight and identity, not the color; tinting keeps the heavy solid glyphs.

**Adopt a third-party stroke set (Lucide / Feather / Tabler).** Rejected: the product's glyphs are bespoke (agent preset, tree corner, dashboard heroes, file-type marks) that no library carries; a library set would still need custom additions and would mix two visual sources.

**Hand-tune each glyph's stroke without a shared frame.** Rejected: 78 independent svgs drift in line weight and cap style; the shared frame pins the family contract in one place.

## Consequences

- The icon set reads as one consistent line family across the sidebar, dashboards, tool cards, and the details column.
- `icons.client.spec.tsx` asserts the 78-glyph count, per-glyph default sizes, `currentColor` with no hardcoded palette, and the id/clip-path-free goal glyph.
- `ui-primitives` README (en + zh) now names the "stroke icon family" rather than the `ic_ds_*` Figma set.

## Related

- [Open Harness dashboards, dark palette, and brand-red accent](2026-09-10-open-harness-dashboard-and-red-accent.md) — the accent refresh whose nine added glyphs join the family.
- [Open Harness details, file inspector, and terminal chrome](2026-09-10-open-harness-details-terminal-chrome.md) — the chrome this line weight aligns with.
- [Web styling system](../process/2026-07-19-web-styling-system.md) — the no-literal-color rule the family follows.
