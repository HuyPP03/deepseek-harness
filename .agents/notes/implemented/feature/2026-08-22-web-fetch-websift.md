# Agent Note: the keyless SSRF-safe fetch route (web-fetch-websift)

Status: implemented

English | [中文](2026-08-22-web-fetch-websift.zh.md)

## Problem

`web_fetch` shipped disabled in every composition: the `dsh-base` layer mounted no fetch provider, and every agent preset's `tool-web` row set `fetch: false`. The only fetch provider that existed, `dsh-web-fetch-http`, defers SSRF protection (no private/loopback blocking, no DNS revalidation), and because the model chooses the request target, shipping it enabled would make the harness an out-of-the-box SSRF tool. The websift library the search route already embeds ships an SSRF-safe page fetch (non-global-address preflight, HTML-to-markdown, PDF-to-text), but its fetch half was not exposed as a `WebFetchProvider`.

## Decision

`@deepseek-ai/dsh-web-fetch-websift` wraps websift's `fetchStructured` in a `WebFetchProvider` registered on the web capability seam as id `websift` — the fetch-side sibling of `web-search-websift`. One `WebSearchClient` per operation, built from `AppSettings.create()` so the library's environment variables never leak into the harness config surface; the provider config is `allowHttp` (default `false`), `timeoutMs` (default `30_000`, converted to the library's seconds), and `maxPageChars` (default `128_000`, the library's own default).

The seam mapping keeps the library's rendered markdown verbatim as a `text` body (so `dsh-tool-web`'s text path passes it through unchanged), returns `finalUrl` as `url`, and sets the seam's `truncated` from the library's page-cap truncation. Failure categories map onto the seam vocabulary: `blocked` → `WEB_BLOCKED_URL`, `empty_input` → `WEB_INVALID_URL`, `timeout` → `WEB_FETCH_TIMEOUT`, `overflow` → `WEB_FETCH_TOO_LARGE`, `unsupported_content` → `WEB_UNSUPPORTED_CONTENT_TYPE`, everything else (including the classified non-2xx categories `http_error`/`auth`/`rate_limit`/`unavailable`) → `WEB_PROVIDER_ERROR` with the library's sanitized message and the fallback `websift fetch failed (<category>)`. Caller cancellation is raced against the library call (`WEB_ABORTED`), since the library accepts no signal.

The `dsh-base` layer now mounts the row, points `web.fetchProvider` at `websift` (explicit, mirroring `searchProvider`), and the `fetch: false` override leaves the `tool-web` rows of the base layer and all four agent presets — `web_fetch` is enabled in every mode on the same keyless route as `web_search`.

The SSRF wall is a fixed invariant, not a configuration: the library refuses loopback, private, link-local, CGNAT, and unique-local destinations — including DNS-resolved hosts and IPv4-mapped IPv6 literals — before any request leaves the process, and refuses `http://` targets unless `allowHttp` is set (the address wall still applies). A non-2xx response is a *failure* on this route — the library classifies the status and the provider surfaces the classified failure — unlike `dsh-web-fetch-http`, where a non-2xx response is a result with a status code and body.

The keyless ACP snapshot scenario `web-fetch-websift` (authored, not recorded: a live model cannot be coaxed into a stable loopback fetch) drives the scripted model to call `web_fetch` with a loopback `https` URL and an `http` URL; the real provider refuses both before any request leaves the process, and the tool results pin the model-visible errors `Error: Blocked: '127.0.0.1' is a non-global address.` and `Error: Blocked: http URLs are not allowed (set FETCH_ALLOW_HTTP=true).` with their `WEB_BLOCKED_URL` metadata. The scenario shares the `web` header-pin class with the existing `web-fetch` scenario, whose composition produces the identical request header.

## Alternatives considered

- **Ship `web-fetch-http` enabled.** Rejected: it defers SSRF protection and the model chooses the request target; enabling it by default would ship an SSRF tool out of the box. It stays available as an explicit composition choice for deployments that accept that risk.
- **Expose the library's narrower knobs (`allowedPorts`, `allowedDomains`, `deniedDomains`).** Deferred: no shipped composition needs them; the wall is a security invariant, and a deployment-specific allowlist is a separate trust decision that lands with a real consumer.
- **Treat non-2xx as a result (parity with `web-fetch-http`).** Rejected: the library's contract for a non-2xx response is a structured, classified failure, and forcing a result would invent a decoded-body guarantee the seam cannot vouch for. The model-visible difference is documented in the package README.

## Consequences

- `web_fetch` works keyless out of the box, on the same in-process websift route as `web_search`; the base layer selects both providers explicitly by id.
- Loopback and private targets are unreachable from the model by design — a local dev server is out of reach, and no configuration narrows the wall.
- A non-2xx response surfaces as `Error: Failed to fetch URL: HTTP <status>` instead of a result with a body: a coarser signal than `dsh-web-fetch-http`, the price of shipping the route enabled.
- Extraction quality, the 10 MiB download cap, the PDF bounds (50 pages / 128,000 chars), and the 5-hop redirect bound track the pinned websift version; the package exposes only its three config keys.
- `dsh-web-fetch-http` remains the second fetch backend on the seam; a composition that needs its non-2xx-as-result semantics (and accepts the missing SSRF protection) selects it by id.
- No UI settings section: the tunables are per-composition `cordis.yml` config, parity with `dsh-web-fetch-http`.

## Verification

- `packages/web/web-fetch-websift`: 32 unit tests at 100% per-file coverage — success, mapping, truncation, and `statusCode: null` handling through a fake backend provider inside a real `WebSearchClient`; production-client SSRF refusals (loopback `https`, private IP, `http` scheme, malformed and empty input, `allowHttp` lifting the scheme but not the wall); category mapping; cancellation (pre-aborted, live abort, sync abort during construction, abort-shaped rejection); `Config({})` defaults; and real-composition tests through `WebRuntime` and `ctx.web.fetch` with fiber disposal.
- The keyless ACP snapshot scenario `web-fetch-websift` replays through the real tool pipeline and pins both refusal texts plus the `WEB_BLOCKED_URL` error metadata in the session log.
- The `dsh-base` and preset wiring shows in the regenerated `apps/cli/composition.md`; the provider registers no settings section, so the `plugin-config` golden is unaffected.
