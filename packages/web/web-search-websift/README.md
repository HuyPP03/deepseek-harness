# @deepseek-ai/dsh-web-search-websift

English | [中文](README.zh.md)

A [websift](https://www.npmjs.com/package/websift)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It embeds the websift TypeScript library in-process — no MCP sidecar, no separate transport process — and drives its keyless backends: `ddgs` (DuckDuckGo HTML search, zero configuration) and `searxng` (your own SearXNG instance behind `baseUrl`).

This is an **implementation** package: it registers a provider into `ctx.web`, owns the keyless backend allowlist and the settings section, and does not register a model-facing tool. Like `@deepseek-ai/dsh-web-search-deepseek`, it is a function/namespace plugin (`inject: ['web']`).

## Config

| Key | Default | Meaning |
|---|---|---|
| `provider` | `ddgs` | Keyless websift backend: `ddgs` or `searxng`. |
| `baseUrl` | omitted | SearXNG endpoint base (required when `provider` is `searxng`); an unparseable value makes the provider unavailable. |
| `allowHttp` | `false` | Allow `http://` SearXNG endpoints for local/self-hosted instances. |

```yaml
- id: web-search-websift
  name: '@deepseek-ai/dsh-web-search-websift'
  config:
    provider: searxng
    baseUrl: http://searxng.internal:8080
    allowHttp: true
```

The entry above is the base layer of the `web-search-websift` settings section: a user layer over it reaches the NEXT search, because the provider projects the section per call rather than capturing it at registration. The seam's provider selection therefore never flickers when the backend or endpoint changes.

## Mapping

websift returns no model-generated answer, so `content` is omitted. `sources[]` comes from websift's `SearchResult[]`: `url` ← `url`, `title` ← `title`, `snippet` ← `snippet`. The keyless backends return no publication date, so `publishedAt` never appears. Results with an empty `url` are dropped, and empty `title`/`snippet` fields are omitted rather than invented.

`maxResults` is sent as the request bound (each backend honors it; on the SearXNG wire it is `number_of_results`), and the seam enforces it again by truncating `sources[]` and setting `truncated`.

Provider failures surface as `WebError` `WEB_PROVIDER_ERROR` — websift's structured `errorCategory`/`errorMessage` is sanitized into the message, and an unexpected rejection becomes `websift search failed: <error>`; when the response carries a category but no message, the fallback is `websift search failed (<category>)`. Caller cancellation surfaces as `WEB_ABORTED`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, and snippets or its exact `websift search failed: <error>`, `websift search failed (<category>)`, and `websift search aborted` failures under the consumer's error wrapper while provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No `publishedAt`** — websift's keyless backends return no publication date, so the tool renders sources without the date suffix.
- **Keyed backends deferred** — websift's `brave`/`exa`/`serper`/`tavily` providers carry API keys, but its `ProviderHttpClient` follows redirects (`redirect: "follow"`), violating this package group's reject-redirects rule for credential-bearing provider requests. Keyed backends land when the upstream client can reject redirects before the `Location` target is contacted.
- **`ddgs` is DuckDuckGo HTML scraping** — keyless but rate-limited and region-blocked; a self-hosted SearXNG endpoint is the stable alternative, and the SearXNG backend fails loud at search time when its endpoint is unreachable.
- **Search only; fetch lives in a sibling package** — this package exposes no fetch route. The library's page fetch (SSRF-safe, HTML-to-markdown, PDF-to-text) ships as [`@deepseek-ai/dsh-web-fetch-websift`](../web-fetch-websift/README.md), which the base mounts and points `web.fetchProvider` at with `web_fetch` enabled.
