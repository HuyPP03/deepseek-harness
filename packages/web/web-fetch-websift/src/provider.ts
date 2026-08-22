/**
 * Websift-backed fetch through the in-process `websift` TypeScript library:
 * SSRF-safe retrieval (loopback, private, and link-local targets are refused
 * before any request leaves the process), HTML-to-markdown conversion, and
 * PDF-to-text. The library owns transport and extraction; this provider owns
 * the seam mapping, cancellation, and error vocabulary.
 * @module @deepseek-ai/dsh-web-fetch-websift/provider
 */

import { AppSettings, fetchResultOk, WebSearchClient } from 'websift'
import type { FetchResult } from 'websift'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const WEBSIFT_FETCH_PROVIDER_ID = 'websift'

/**
 * Resolved provider options. The plugin's `apply` supplies defaults, so every
 * field this provider reads is fully resolved.
 */
export interface WebsiftFetchProviderOptions {
  /** Whether `http://` (non-TLS) target URLs are allowed. */
  readonly allowHttp: boolean
  /** Provider-side fetch timeout in milliseconds. */
  readonly timeoutMs: number
  /** Maximum rendered page length in characters. */
  readonly maxPageChars: number
  /**
   * Test seam replacing the real client for one operation. Production passes
   * none; tests substitute a client whose backend is a fake provider object.
   */
  readonly clientFactory?: (request: WebFetchRequest) => WebSearchClient
}

/**
 * The websift-backed fetch provider. Builds one `WebSearchClient` per
 * operation (the constructor is synchronous and performs no I/O), runs the
 * URL through the library's SSRF preflight and retrieval, and maps the
 * structured result onto the seam's normalized fetch result.
 */
export class WebsiftFetchProvider implements WebFetchProvider {
  readonly id = WEBSIFT_FETCH_PROVIDER_ID

  /**
   * @param options - the fully resolved options for every operation. The
   *   plugin's settings-free registration captures them once, so a fetch never
   *   mixes two config values.
   */
  constructor(private readonly options: WebsiftFetchProviderOptions) {}

  /**
   * Keyless local usability check: no credentials to check, so an anonymous
   * SSRF-safe fetcher is always usable.
   */
  available(): boolean {
    return true
  }

  /**
   * Retrieve one URL through the library's SSRF-safe fetch.
   * @param request - the URL to fetch.
   * @param signal - optional cancellation signal; the library accepts none, so
   *   the call is raced against it.
   * @returns the normalized result: the library's rendered markdown text as
   *   the `text` body, with its `truncated` or `overflow` flag.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    throwIfFetchAborted(signal)
    const options = this.options
    const client = options.clientFactory !== undefined
      ? options.clientFactory(request)
      : new WebSearchClient(buildClientOptions(options))
    let result: FetchResult
    try {
      result = await abortable(client.fetchStructured(request.url), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error)
      throw new WebError(`websift fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    } finally {
      // Closes any lazily created backend resources; a no-op without one.
      await client.close()
    }
    throwIfFetchAborted(signal)
    if (!fetchResultOk(result)) {
      throw fetchFailure(result)
    }
    return {
      url: result.finalUrl.length > 0 ? result.finalUrl : result.requestedUrl,
      // The seam type requires a status number; the library emits one on every
      // success path and null only on failures rejected above.
      statusCode: result.statusCode ?? 0,
      body: { kind: 'text', content: result.content },
      truncated: result.truncated || result.overflow,
    }
  }
}

/**
 * Build the library client options for one operation from the resolved
 * provider options. The library's `AppSettings.create()` defaults are the
 * transport baseline (byte caps, redirect hops, PDF page bounds); the provider
 * options override the fetch scheme policy, the fetch timeout, and the rendered
 * page cap. `create()` (not `fromEnv`) keeps the library's environment from
 * leaking into the harness's config surface.
 * @param options - the resolved provider options.
 * @returns the client options for one operation.
 */
function buildClientOptions(options: WebsiftFetchProviderOptions) {
  const settings = AppSettings.create()
  return {
    settings: {
      ...settings,
      fetch: { ...settings.fetch, allowHttp: options.allowHttp },
      extraction: { ...settings.extraction, maxPageChars: options.maxPageChars },
    },
    fetchTimeout: options.timeoutMs / 1000,
  }
}

/**
 * Map a failed structured result onto the seam's error vocabulary: the library
 * sanitizes the message itself, and a category without a message gets the same
 * fallback the search provider uses.
 * @param result - the failed structured fetch result.
 * @returns the seam error with the mapped code.
 */
function fetchFailure(result: FetchResult): WebError {
  // fetchResultOk already established a non-null category.
  const category = String(result.errorCategory)
  const message = result.errorMessage ?? `websift fetch failed (${category})`
  return new WebError(message, mapCategory(category))
}

/**
 * Map the library's failure categories onto the seam's error vocabulary.
 * `blocked` is a URL-policy refusal (scheme, embedded credentials, non-global
 * address, port or domain policy); the empty-input and unsupported-content
 * categories have dedicated seam codes; the transport categories keep the
 * shared provider-failure code, which is also the default for library
 * categories this mapping has not named.
 * @param category - the library's failure category.
 * @returns the seam error code.
 */
function mapCategory(category: string): string {
  switch (category) {
    case 'blocked':
      return 'WEB_BLOCKED_URL'
    case 'empty_input':
      return 'WEB_INVALID_URL'
    case 'timeout':
      return 'WEB_FETCH_TIMEOUT'
    case 'overflow':
      return 'WEB_FETCH_TOO_LARGE'
    case 'unsupported_content':
      return 'WEB_UNSUPPORTED_CONTENT_TYPE'
    default:
      return 'WEB_PROVIDER_ERROR'
  }
}

/* Deliberate parallel to the sibling web-search-websift provider's helpers:
 * the two websift-backed providers stay self-contained, and the abort race is
 * generic provider plumbing the seam does not own. */
/* jscpd:ignore-start */

/**
 * Race a same-process asynchronous operation against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(fetchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(fetchAborted(signal)) }
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
function throwIfFetchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw fetchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function fetchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('websift fetch aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/* jscpd:ignore-end */
