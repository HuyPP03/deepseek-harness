# Agent Note: slash surfaces live with their feature package — `/mode` moves to ui-agent-preset

Status: implemented

English | [中文](2026-08-21-slash-surface-ownership-to-feature-packages.zh.md)

## Problem

The `/mode` decoration was registered in `@deepseek-ai/dsh-client-ui-slash-tools` together with `/clear` and `/help`, but its data — the preset roster, the picker rules, the display copy — belongs to `@deepseek-ai/dsh-client-ui-agent-preset`. A generic slash-tools package holding another package's feature is an ownership inversion: every roster change had to be made in the wrong place, and the new `/mcp` decoration (which renders MCP data) hit the same question.

Second, the roster rows rendered preset names and descriptions straight from the preset metadata files, which the deployment writes in one language. The shipped presets (`standard`, `code`, `minimal`, `cordis`, `chat`) therefore displayed in that file language in every browser locale — a Chinese metadata file showed Chinese names in an English Web.

## Decision

- **A slash decoration lives in the feature package that owns the data it renders.** `/mode` moved from ui-slash-tools to ui-agent-preset (its fifth surface, registered exactly as before: available on non-chat sessions, roster from `agentPreset.list` with broken presets omitted, the pick submitting the completed `/mode <preset>` line through the host command — see [the `/help` and `/mode` note](../feature/2026-08-20-web-help-mode-client-surfaces.md) for that mechanism, which is unchanged). `/mcp` follows the same rule in `@deepseek-ai/dsh-client-ui-mcp` (see [its note](../feature/2026-08-21-mcp-client-surface-and-settings-panel-deep-link.md)). ui-slash-tools keeps only the surfaces with no feature owner: `/clear` (client-only session reset) and `/help` (the merged menu view); its inject list drops `connection` and `remote.commands`.
- **Shipped preset copy is client-owned locale.** ui-agent-preset renders every roster row through `presetDisplayText`: a preset with `trust: 'system'` whose id is a shipped preset (`standard`, `code`, `minimal`, `cordis`, `chat`) reads name and description from the `settings.agentPreset` locale dictionary; anything else keeps the file metadata (name falling back to the id). User-authored preset files are not made translatable — the client cannot own the language of deployment files, and forcing i18n on them would make the metadata format a translation target.

## Alternatives considered

- **Keep `/mode` in ui-slash-tools and inject ui-agent-preset's stores.** Rejected: it entrenches the inversion — the data owner depending on a generic tools package for its own surface — and every later preset change would cross the boundary again.
- **i18n the preset metadata files** (per-locale name/description fields). Rejected: the files are deployment artifacts users edit by hand; a translation schema turns a deployment format into a localization format and silently drops the user's own wording for unknown locales.
- **A per-surface rule instead of a general ownership rule.** Rejected: the `/mcp` surface made the second instance in the same change; the rule is the decision, the two moves are its instances.

## Consequences

- ui-slash-tools is now smaller and more honest: two surfaces, four injects, no wire reads of another feature's data.
- A new shipped preset id must get its `settings.agentPreset` locale keys in the same change, or it falls back to the file metadata (name to id).
- The [web help/mode note](../feature/2026-08-20-web-help-mode-client-surfaces.md) is updated in place to say where the `/mode` decoration registers; its mechanism decisions (the host-command submit, the chat exclusion, the broken-preset filter) are unchanged.
