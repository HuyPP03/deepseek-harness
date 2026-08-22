# Agent Note: the keyless in-process websift search route

Status: implemented

English | [中文](2026-08-22-web-search-websift.zh.md)

## Problem

`web_search`'s shipped default required a key: the `dsh-base` layer pointed `web.searchProvider` at the DeepSeek provider, which is unavailable without `DEEPSEEK_API_KEY`, so a fresh keyless installation had a model-facing tool that only failed. The keyless route that did exist (websift's DuckDuckGo backend) reached the harness only as an out-of-tree MCP sidecar in a user's own profile — a separate process, transport, and lifecycle for one search call.

## Decision

`@deepseek-ai/dsh-web-search-websift` embeds the [websift](https://www.npmjs.com/package/websift) TypeScript library in-process and registers provider id `websift` on the web capability seam. It exposes exactly the two keyless backends — `ddgs` (DuckDuckGo, zero configuration, the default) and `searxng` (a self-hosted endpoint behind `baseUrl`, `allowHttp` for `http://` instances) — and owns the `web-search-websift` settings section, which the provider projects per search call, so a settings write reaches the next search without re-registration and the seam's selection never flickers.

The `dsh-base` layer now composes `web.searchProvider: websift` with the new row and keeps `web-search-deepseek` mounted but `disabled: true`: re-enabling the keyed route is re-pointing `web.searchProvider` at `deepseek-official` plus un-disabling the row (it resolves the same key the Models page manages). The `searchTimeoutMs: 60000` overrides left on the `tool-web` rows of the base layer and the four agent presets are dropped, so the tool's neutral 30 s default applies to both operations.

The settings card follows: `ui-settings-plugins` reworks its web-search card to a closed-choice backend field plus the endpoint, and the credentials machinery (`CardSecretSpec` and its wiring) leaves `CardForm` with no remaining consumer. The `web-search-round` web e2e goes keyless: the real provider runs against a local SearXNG double that honors `number_of_results`, so the provider bounds the request at the wire layer, the seam receives exactly its cap, and the settled card renders without a truncation note.

## Alternatives considered

- **Keep the MCP sidecar as the default.** Rejected: it is a separate process and streamable-HTTP transport for work the library can do in-process; the in-process route deletes the transport, its credentials, and its lifecycle. A user profile that still mounts it keeps working — the seam picks by provider id, and the deployment's own patch decides the route.
- **Keep DeepSeek search as the shipped default.** Rejected: it is the keyed route; a fresh install has no key, so the default route must be keyless to make `web_search` work at all.
- **Ship the keyed websift backends (`brave`, `exa`, `serper`, `tavily`).** Deferred: websift's `ProviderHttpClient` follows redirects (`redirect: "follow"`), and the package group's rule rejects redirects on credential-bearing provider requests. They land when the upstream client can reject redirects before the `Location` target is contacted.
- **Perplexity or Exa as the default.** Rejected on the same ground as DeepSeek: both are keyed, and Perplexity returns no more of what a keyless default needs.

## Consequences

- `web_search` works keyless out of the box; the `ddgs` default is DuckDuckGo HTML scraping — rate-limited and region-blocked in places — and a self-hosted SearXNG endpoint is the stable alternative, configured through the settings card or the section's cordis layer.
- The keyless backends return no publication date, so the tool renders sources without the date suffix and the `publishedAt` field never appears in the structured result.
- The seam's truncation note appears only when the seam actually cuts: because each backend honors the request bound, the shipped route's lists are complete and the note is normally absent.
- A deployment that wants the DeepSeek route re-points `web.searchProvider` and un-disables the row; the two routes coexist in `dsh-base` and the seam selects by id.

## Verification

- `packages/web/web-search-websift`: 26 unit tests at 100% per-file coverage, including real-composition settings tests (stored endpoint reaches the next search, namespace release on unload) and a local HTTP double asserting the SearXNG wire parameters.
- `pnpm run test:gui` covers the reworked card (staging, closed-choice denial, save/clear); the `plugin-config` web e2e pins the new card copy in the aria golden.
- `apps/web/tests/web-search-round.e2e.ts` (replay mode, keyless) drives the real provider end-to-end against the double and pins the settled card golden; `DSH_SNAPSHOT=refresh` rewrites the golden after a deliberate presentation change.
