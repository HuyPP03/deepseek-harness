# Agent Note: Client locale en-first: three languages with English as default and key source

Status: proposed

English | [中文](2026-08-22-client-locale-en-first-vietnamese.zh.md)

## Problem

The client locale substrate shipped with two languages, Chinese as the product default: `zh` was the dictionary key source, `en` the translation locked against it, and `FALLBACK_LOCALE` was `zh`. The repositioned product ships in English: a fresh browser with no signal should open in English, Vietnamese is a first-class product language for the primary user base, and Chinese moves to secondary. The old canon made English the second-class citizen — key identity, the lookup floor, and the key-echo failure mode were all defined by the Chinese table, so an English-default product would need English to be the fallback floor and the non-source translation at once, with completeness enforced against the wrong table.

## Proposal

**The locale set is `['en', 'vi', 'zh']` with `en` as default and key source.** `LOCALE_IDS`/`FALLBACK_LOCALE` in `packages/client/locale` move to `en`; the settings store accepts `vi`; the Language row lists three self-described options (English / Tiếng Việt / 中文, each self-named in its own settings dictionary). The lookup chain keeps its shape with `en` as the floor at every stage: `ns[active] → ns[en] → common[active] → common[en] → key echo`.

**The dictionary canon inverts.** Every namespace table declares `en` as the key source (`satisfies Record<string, string>`); `vi` and `zh` are `Record<XxxKey, string>`, so the compiler forces both to cover every key. The common namespace's key set is `keyof en`. Adding a key costs three tables at author time and buys zero untranslated runtime.

**Product copy in code is English.** The zero-cordis ui-primitives atoms move from their Chinese hardcoded strings to English defaults — a consumer passing nothing renders the English surface. The four content blocks (Diff/Read/Search/Web) gain the `labels` prop TerminalBlock/JsonTree already carry, and their shared vocabulary (expand/collapse aria, truncation, showing-of, plural units, empty states) moves to the common locale namespace, because the same blocks are drawn by two features with different seats — the conversation tool row and the file inspector — and a cross-plugin import is not a sanctioned route. Each feature resolves the common keys through its own seat in a small label builder. The `verify-product-copy` gate keeps CJK out of client `src` except allow-listed dictionaries (the locale package, each namespace `locales.ts`, the onboarding copy, one deliberate wire fixture) and one line-level allow (the QuestionComposer wire regex).

**Boundary decisions.** Preset display names are English in all three tables. ui-trajectory's `vi` deliberately mirrors `en` (a developer inspection surface, the same ruling that keeps its `zh` all-English); the mirrored tables carry a narrow `jscpd:ignore` marker so the duplication gate reads the mirror as the boundary it is. CJK test fixtures (ansi wide-glyph, markdown CJK punctuation, the connection fixture, the deliberate wire strings) stay CJK. A durable `preference: 'zh'` remains valid — no data migration; an unknown id still fails.

**Scope against the e2e doctrine.** The web e2e scenarios keep asserting the copy they assert (the zh scenarios open a `zh-CN` browser); the snapshot re-record to the English default and the first `vi` scenario land in the follow-up phase of the same plan.

## Related

- [Full client copy rollout onto the typed locale seat](../../implemented/architecture/2026-07-30-client-locale-full-rollout.md) — its mechanisms (label thunks, the `t` seat, props for the zero-cordis atoms, the non-translation boundary) stand; its two-language canon and the zh default are superseded by this note.
- [Browser-derived initial locale](../../implemented/feature/2026-07-31-browser-derived-initial-locale.md) — the provisional-locale mechanism stands unchanged; this note changes the fallback it defers to, from `zh` to `en`.

## Alternatives considered

- **Keep `zh` as the key source and add `vi`**: the minimal change, but key identity and the lookup floor would stay Chinese while the product default is English — the fallback language is not the key source, and completeness is enforced against the wrong table.
- **Two languages with `vi` aliased to `en`**: vi is a first-class product language for the primary user base, not a fallback alias; aliasing silently degrades Vietnamese users and hides the degradation.
- **Keep the Chinese atom defaults and pass English labels at every call site**: the atom defaults are exactly what a not-yet-wired consumer renders, so Chinese defaults in an English-first product leave unmigrated surfaces Chinese — the mixed-language accident the gate exists to catch.
- **A config option for the default locale**: the default is a product decision, not a deployment variable; repo policy reserves `Config` fields for deployment-varying choices with a current consumer.

## Acceptance criteria

- A fresh browser with no Host preference opens in the language its navigator asks for (vi, zh, or en), and no signal at all opens in English.
- Every registered namespace's three locale tables compile-complete against the en key set; the typecheck is the gate.
- `verify-product-copy` passes on the tree and fails (exit 1 with `file:line`) on a planted stray CJK literal in client `src` outside the allow-list.
- The block surfaces render their English defaults with no props and dictionary copy with labels; the locale package specs pin the three-option list, the fallback chain, and the three-value round-trip.
- `test:gui` and the repo typecheck are green.

## Risks

- The vi translations are first-pass quality across ~700 client strings; user-facing wording can shift later without a mechanism change (the tables are the only edit site).
- A new key costs three tables instead of two; a forgotten vi or zh value fails the build instead of surfacing as a key echo in the UI.
- The allow-listed CJK (the wire fixture, the QuestionComposer regex) stays outside the gate by design; the list must be reviewed when it grows.
- The en-first flip changes what a no-signal browser sees; any surface that assumed the zh default (docs, screenshots, the e2e zh-scenario doctrine) is covered by the follow-up phases of the plan rather than by this note.
