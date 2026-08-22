# @deepseek-ai/dsh-web-fetch-websift

English | [中文](README.zh.md)

A [websift](https://www.npmjs.com/package/websift)-backed `WebFetchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It embeds the websift TypeScript library in-process and runs every target URL through the library's SSRF-safe retrieval: loopback, private, and link-local destinations are refused before any request leaves the process, then the page is converted to markdown (or read as PDF text). It is the fetch route the [base bundle](../../bundle/base/README.md) ships with `web_fetch` enabled — the first keyless fetch route that can ship on, because its safety wall is a hard invariant rather than deferred work.

This is an **implementation** package: it registers a provider into `ctx.web` and does not own the key and does not register a model-facing tool. Like [`@deepseek-ai/dsh-web-search-websift`](../web-search-websift/README.md), it is a function/namespace plugin (`inject: ['web']`).

## Responsibility split

The provider owns **SSRF-safe retrieval**: URL validation, the scheme policy, the non-global-address refusal, transport (byte caps, same-process redirect bounds, timeout), and extraction (HTML→markdown, PDF→text, rendered-page cap). [`@deepseek-ai/dsh-tool-web`](../tool-web/README.md) owns **presentation**: it passes this provider's rendered text through unchanged, truncates at its own output bound, and wraps provider failures in the tool's error format.

Unlike [`dsh-web-fetch-http`](../web-fetch-http/README.md), a non-2xx HTTP response is a *failure* here, not a result: the library classifies the status (401/403/407 → `auth`, 429 → `rate_limit`, 5xx → `unavailable`, other 4xx → `http_error`) and the provider surfaces each as `WEB_PROVIDER_ERROR` with the library's sanitized message.

The provider's `timeoutMs` is a resource backstop for direct `ctx.web.fetch()` callers and misconfigured deployments, not the model-facing tool-call budget. [`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) owns the `web_fetch` tool-call budget by arming `exec.signal`, which the provider maps to `WEB_ABORTED`.

## The SSRF wall

- Refuses every **non-global destination** before any request: loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`), link-local, CGNAT (`100.64/10`), IPv6 unique-local, and multicast — including DNS-resolved hosts and IPv4-mapped IPv6 literals. The refusal is by design and has no configuration bypass; it is why this route can ship enabled.
- Refuses `http://` (non-TLS) targets by default; `allowHttp: true` lifts the scheme policy only — the address wall still applies.
- The model-visible refusals are the library's verbatim: `Error: Blocked: '127.0.0.1' is a non-global address.` and `Error: Blocked: http URLs are not allowed (set FETCH_ALLOW_HTTP=true).` The keyless ACP snapshot scenario `web-fetch-websift` pins both through the real provider.

## Mapping

A successful fetch returns the library's rendered markdown as a `text` body (so the consumer's text path passes it through unchanged), `url` as the final (post-redirect) URL or the requested one, the library's status code, and `truncated` from the library's page-cap truncation.

Failures carry the library's sanitized message; a category without a message gets the fallback `websift fetch failed (<category>)`:

| websift category | seam code |
|---|---|
| `blocked` (scheme, credentials, non-global address) | `WEB_BLOCKED_URL` |
| `empty_input` | `WEB_INVALID_URL` |
| `timeout` | `WEB_FETCH_TIMEOUT` |
| `overflow` (raw download beyond the library's byte cap) | `WEB_FETCH_TOO_LARGE` |
| `unsupported_content` | `WEB_UNSUPPORTED_CONTENT_TYPE` |
| everything else (`http_error`, `auth`, `rate_limit`, `unavailable`, `network`, `decode`, `redirect`, `provider`, `unknown`) | `WEB_PROVIDER_ERROR` |

An unexpected rejection from the library becomes `websift fetch failed: <error>` as `WEB_PROVIDER_ERROR`; caller cancellation surfaces as `websift fetch aborted` (`WEB_ABORTED`).

## Config

| Key | Default | Meaning |
|---|---|---|
| `allowHttp` | `false` | Allow `http://` (non-TLS) target URLs; the non-global-address wall still applies. |
| `timeoutMs` | `30_000` | Provider fetch timeout in milliseconds, converted to the library's seconds — a resource backstop for direct `ctx.web.fetch()` callers, not the model-facing tool-call budget (that is `dsh-tool-call-timeout-policy`). |
| `maxPageChars` | `128_000` | Rendered page cap in characters; beyond it the library truncates the page text (the result still succeeds, flagged `truncated`). The raw byte download limit is a separate library constant that fails the fetch (`WEB_FETCH_TOO_LARGE`). |

```yaml
- id: web-fetch-websift
  name: '@deepseek-ai/dsh-web-fetch-websift'
  config:
    allowHttp: true
```

The base bundle mounts the row with the defaults and points `web.fetchProvider` at `websift`, alongside the keyless search route.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's rendered markdown (with the library's truncation marker) or its exact failures — `Error: Blocked: …` for a refused URL, `Error: Failed to fetch URL: HTTP <status>` for a non-2xx response, `Error: websift fetch failed: <error>` — under the consumer's error wrapper while provider-private fields (byte counts, redirect count, content type) remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Non-2xx responses never reach the model as results** — the model sees the library's sanitized status message, not the status code or the response body, which is a coarser signal than `dsh-web-fetch-http`'s result-with-status-code (the trade is that this route can ship enabled).
- **The address wall has no bypass** — loopback and private targets are always refused; a local dev server is unreachable by design. The library's narrower knobs (`allowedPorts`, `allowedDomains`, `deniedDomains`) are not exposed.
- **Extraction follows the websift library version** — HTML→markdown quality, PDF support (50 pages / 128,000 chars), the 10 MiB download cap, and the 5-hop redirect bound come from the library's transport baseline (`AppSettings.create()` defaults, never its environment); this package exposes only the three config keys above.
- **No UI settings section** — parity with `dsh-web-fetch-http`; the tunables are per-composition `cordis.yml` config, not a per-user settings card.
