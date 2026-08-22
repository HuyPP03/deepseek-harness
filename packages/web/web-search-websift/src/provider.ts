/**
 * Websift-backed search through the in-process `websift` TypeScript library
 * (DuckDuckGo HTML results by default, or a self-hosted SearXNG endpoint).
 * Each search is one direct HTTP exchange — no auxiliary model turn. The
 * library is the transport owner; this provider owns the seam mapping,
 * availability, cancellation, and error vocabulary.
 * @module @deepseek-ai/dsh-web-search-websift/provider
 */

import { WebSearchClient } from 'websift'
import type { SearchResponse } from 'websift'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const WEBSIFT_PROVIDER_ID = 'websift'

/** The keyless websift backends this package ships (v1 scope). */
export type WebsiftProviderName = 'ddgs' | 'searxng'

/**
 * The keyless provider names this package accepts. Keyed backends (brave,
 * exa, serper, tavily) are deferred: websift's provider HTTP transport follows
 * redirects, and the web packages' policy rejects redirects on
 * credential-bearing provider requests.
 */
export const WEBSIFT_PROVIDER_NAMES: readonly WebsiftProviderName[] = ['ddgs', 'searxng']

/**
 * Resolved provider options. The plugin's `apply` supplies defaults, so every
 * field this provider reads is fully resolved; `baseUrl` is present exactly
 * for the backends that take an endpoint.
 */
export interface WebsiftSearchProviderOptions {
  /** The keyless websift backend to search through. */
  readonly provider: WebsiftProviderName
  /** SearXNG endpoint base; present when `provider` is `searxng`. */
  readonly baseUrl?: string
  /** Whether `http://` provider endpoints are allowed (local/self-hosted). */
  readonly allowHttp: boolean
  /**
   * Test seam replacing the real client for one operation. Production passes
   * none; tests substitute a client whose backend is a fake provider object.
   */
  readonly clientFactory?: (request: WebSearchRequest) => WebSearchClient
}

/**
 * The websift-backed search provider. Builds one `WebSearchClient` per
 * operation (the constructor is synchronous and performs no I/O), runs the
 * query against the configured keyless backend, and maps the structured
 * response onto the seam's normalized result.
 */
export class WebsiftSearchProvider implements WebSearchProvider {
  readonly id = WEBSIFT_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two settings
   * sections. A thunk rather than a value because the plugin's settings
   * section can change between searches, and re-registering the provider to
   * carry a new endpoint would make the seam's selection observable to the
   * user as a flicker.
   */
  constructor(private readonly resolveOptions: () => WebsiftSearchProviderOptions) {}

  /**
   * Keyless local usability check: `ddgs` is always usable; `searxng` needs a
   * parseable endpoint. No network calls.
   */
  available(): boolean {
    const options = this.resolveOptions()
    return options.provider === 'ddgs'
      || (options.baseUrl !== undefined && URL.canParse(options.baseUrl))
  }

  /**
   * Run one search through the configured keyless backend.
   * @param request - the query and optional result limit; the limit is applied
   *   at the request layer (websift bounds its own parsing) and re-enforced by
   *   the seam on the way back.
   * @param signal - optional cancellation signal; the library accepts none, so
   *   the call is raced against it.
   * @returns the normalized sources; `truncated` stays false here because the
   *   seam owns the final `maxResults` truncation.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    throwIfSearchAborted(signal)
    const client = options.clientFactory !== undefined
      ? options.clientFactory(request)
      : new WebSearchClient({
        provider: options.provider,
        ...request.maxResults !== undefined ? { maxResults: request.maxResults } : {},
        ...options.provider === 'searxng'
          ? { baseUrl: options.baseUrl, allowHttp: options.allowHttp }
          : {},
      })
    let response: SearchResponse
    try {
      response = await abortable(client.searchStructured(request.query), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`websift search failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    } finally {
      // Closes any lazily created backend resources; a no-op without one.
      await client.close()
    }
    throwIfSearchAborted(signal)
    if (response.errorCategory != null) {
      const message = response.errorMessage ?? `websift search failed (${response.errorCategory})`
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }
    return { sources: mapResults(response.results), truncated: false }
  }
}

/**
 * Map websift's structured results onto the seam's portable citation shape.
 * websift returns no publication timestamp, so sources never carry
 * `publishedAt`. Empty urls are dropped; empty titles/snippets are omitted
 * rather than invented.
 * @param results - the websift results, in provider order.
 * @returns the normalized sources.
 */
function mapResults(results: SearchResponse['results']): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const result of results) {
    if (result.url.length === 0) continue
    sources.push({
      url: result.url,
      ...result.title.length > 0 ? { title: result.title } : {},
      ...result.snippet.length > 0 ? { snippet: result.snippet } : {},
    })
  }
  return sources
}

/**
 * Race a same-process asynchronous operation against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('websift search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
