# Agent Note: Shipped presets, the GUI document, and the docs site in English

Status: proposed

English | [中文](2026-08-22-presets-en-website-locales.zh.md)

## Problem

The client locale canon flipped to English-first in the [locale set note](2026-08-22-client-locale-en-first-vietnamese.md), but three product surfaces still carried Chinese as their default: the five shipped agent presets publish their display names and descriptions in Chinese in `preset.yml` (the source of truth behind `dsh preset list`, the preset copy flow, and the reference docs); the assembled GUI document declares `lang="zh-CN"`; and the documentation website serves Chinese at the root route with English under `/en/`, so the default landing language of the product's docs is Chinese.

## Proposal

**The shipped presets carry the English product copy.** The `name` and `description` fields of the five `preset.yml` files now read the English strings the client locale tables' `en` column already carries. The GUI display of system presets is untouched — the localized tables still override file metadata for `trust: 'system'` rows — so what moves is the file-derived surface: the CLI preset list, the copy flow (a copy of a shipped preset now inherits the English description; the authoring e2e pins it), and the reference docs. A Chinese-locale browser still sees the localized names from the tables.

**The GUI document is English.** `apps/web/index.html` declares `lang="en"`. Nothing in the client styles or the PWA manifest branches on the document language, so the flip has no rendering consequence beyond the declared language.

**The first Vietnamese web-test surface.** A `vi-VN` browser on a fresh Host home boots into the Vietnamese settings surface (the provisional locale follows the navigator with no stored preference), and the Language row cycles all three locales — English, 中文, Tiếng Việt — each switch re-localizing the settings copy live and persisting the explicit choice to the Host settings document.

**The docs website root is English.** The two-locale manifest (root = Chinese, `/en/` = English) becomes three-locale: the root serves the English sources, Chinese moves to `/zh/`, and a new `/vi/` locale is added. The old `/en/` URLs move to root without redirect shims — the pre-release stance reserves compatibility shims for consumers that exist, and the site has none. Every `/vi/` route intentionally projects the English source until the Vietnamese documentation wave lands the `.vi.md` files; the manifest's existing rule (a missing translation projects the available source instead of copying Markdown) carries that bridge, and the vi sidebar chrome is Vietnamese while its labels mirror the English ones.

## Related

- [Client locale en-first: three languages with English as default and key source](2026-08-22-client-locale-en-first-vietnamese.md) — the locale set, the en key-source canon, and the en fallback this note completes on the preset, document, and website surfaces.
- [Quickstart documentation home](../../implemented/simplification/2026-08-11-quickstart-documentation-home.md) — its locale-root redirect mechanism stands; its route facts were updated in place for the `/en/` move.

## Alternatives considered

- **Keep the Chinese preset files and localize only the GUI**: the GUI already localizes system presets through the tables; the file surface (CLI list, copied user presets, reference docs) would stay Chinese while the product copy canon is English — the source of truth behind a file-derived surface must match the canon.
- **Keep `/en/` as a redirect alias of root**: a compatibility shim for URLs with no external consumers; the pre-release stance rejects shims the first tagged release would have to carry.
- **Add the `/vi/` locale only when the Vietnamese docs land**: the switcher would stay two-way while the product states three languages, and the vi locale's chrome and collections would ship with content instead of ahead of it; the manifest's projection rule makes the vi tree cheap to pre-provision.
- **English chrome for the vi locale until its docs land**: the locale chrome is the point of the locale — a Vietnamese browser that selects Tiếng Việt should read Vietnamese nav, footer, and search strings even while the page content is still the projected English source.

## Acceptance criteria

- The five `preset.yml` files are English; the preset authoring copy flow inherits the English description (e2e-pinned) and the zh GUI table is unchanged.
- A fresh `vi-VN` browser boots into the Vietnamese settings surface and the three-locale cycle persists each explicit choice (e2e scenario `language-locale.e2e.ts`).
- The site root serves the English sources; `/zh/` serves the Chinese sources and `/vi/` serves the projected English sources; `website:build` (the dead-link check) is green.
- The phase acceptance ladder is green: `test:gui`, `typecheck`, `DSH_SNAPSHOT=replay pnpm run test:web`, `doc-sync`, `website:build`, `verify-translation-pairing`, and `lint`.
- The pull request embeds a language-switch GIF (English → Tiếng Việt → 中文) recorded from the pull request's own commit.

## Risks

- The old `/en/` URLs 404 after the flip; the pre-release stance accepts this while no external consumer exists, and the first release notes should carry the move.
- A Vietnamese reader on the site gets English content under Vietnamese chrome until the vi doc wave; the switcher labels the locale honestly, and the projection rule is the manifest's existing answer to a missing translation.
- A copy of a shipped preset starts from an English description; a Chinese user's new preset inherits English metadata they edit in place.
