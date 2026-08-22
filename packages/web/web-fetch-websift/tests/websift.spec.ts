/**
 * Unit behavior of the websift-backed fetch provider: seam mapping, the SSRF
 * policy's deterministic refusals, cancellation, and errors. Mapping tests
 * drive the real `WebSearchClient` against a fake backend object (websift
 * accepts a provider object as well as a name), so no network is touched; the
 * policy tests use IP literals and scheme/blank cases the library decides
 * before any DNS or connection.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createProviderCapabilities,
  WebSearchClient,
  type FetchResult,
  type SearchProvider,
  type SearchResult,
} from 'websift'
import {
  apply,
  Config,
  WEBSIFT_FETCH_PROVIDER_ID,
  WebsiftFetchProvider,
  type WebsiftFetchProviderOptions,
} from '@deepseek-ai/dsh-web-fetch-websift'
import WebRuntime, { type WebFetchResult } from '@deepseek-ai/dsh-web'

/** A public, non-blocked IPv4 literal: it passes the SSRF preflight without DNS. */
const PUBLIC_IP_URL = 'https://93.184.216.34/'

/** A provider whose fetch outcome is fixed; records the URL it received. */
class FakeFetchProvider implements SearchProvider {
  readonly name = 'fake'
  readonly capabilities = createProviderCapabilities()
  requested: string | undefined

  constructor(private readonly outcome: FetchResult) {}

  search(): Promise<SearchResult[]> {
    throw new Error('fake search is not used by the fetch path')
  }

  fetch(url: string): Promise<FetchResult> {
    this.requested = url
    return Promise.resolve(this.outcome)
  }
}

/** A provider that never settles, for observing cancellation of a live call. */
class StalledFetchProvider implements SearchProvider {
  readonly name = 'stalled'
  readonly capabilities = createProviderCapabilities()

  search(): Promise<SearchResult[]> {
    throw new Error('fake search is not used by the fetch path')
  }

  fetch(): Promise<FetchResult> {
    return new Promise<FetchResult>(() => {})
  }
}

/** One structured fetch success, with overridable fields. */
function okResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    requestedUrl: PUBLIC_IP_URL,
    finalUrl: PUBLIC_IP_URL,
    content: 'Rendered markdown',
    contentType: 'text/markdown',
    statusCode: 200,
    bytesRead: 17,
    redirectCount: 0,
    truncated: false,
    overflow: false,
    errorCategory: null,
    errorMessage: null,
    ...overrides,
  }
}

/** The policy options every production-path test runs with. */
const POLICY_OPTIONS: Omit<WebsiftFetchProviderOptions, 'clientFactory'> = {
  allowHttp: false,
  timeoutMs: 30_000,
  maxPageChars: 128_000,
}

/** Build the provider over a fixed options value; production passes a resolved object. */
function provider(
  options: Partial<Omit<WebsiftFetchProviderOptions, 'clientFactory'>> & {
    clientFactory?: NonNullable<WebsiftFetchProviderOptions['clientFactory']>
  } = {},
): WebsiftFetchProvider {
  return new WebsiftFetchProvider({ ...POLICY_OPTIONS, ...options })
}

/** Seed one real client with a fake backend for the fetch path. */
function fetchWithFake(fake: SearchProvider): (request: { url: string }, signal?: AbortSignal) => Promise<WebFetchResult> {
  return (request, signal) => provider({
    clientFactory: () => new WebSearchClient({ provider: fake }),
  }).fetch(request, signal)
}

async function rejected(error: Promise<unknown>): Promise<{ code: string | undefined; message: string; cause: unknown }> {
  return await error.then(
    () => { throw new Error('expected the fetch to reject') },
    (cause: unknown) => ({
      code: (cause as { code?: string }).code,
      message: (cause as Error).message,
      cause: (cause as { cause?: unknown }).cause,
    }),
  )
}

describe('WebsiftFetchProvider', () => {
  it('registers the stable seam id', () => {
    expect(provider(POLICY_OPTIONS).id).toBe(WEBSIFT_FETCH_PROVIDER_ID)
  })

  it('is always available: keyless and credential-free', () => {
    expect(provider(POLICY_OPTIONS).available()).toBe(true)
  })

  it('maps a structured success to the seam result as text markdown', async () => {
    const result = await fetchWithFake(new FakeFetchProvider(okResult()))({ url: PUBLIC_IP_URL })
    expect(result).toEqual({
      url: PUBLIC_IP_URL,
      statusCode: 200,
      body: { kind: 'text', content: 'Rendered markdown' },
      truncated: false,
    })
  })

  it('forwards the requested URL to the backend', async () => {
    const fake = new FakeFetchProvider(okResult())
    await fetchWithFake(fake)({ url: PUBLIC_IP_URL })
    expect(fake.requested).toBe(PUBLIC_IP_URL)
  })

  it('falls back to the requested URL when the final URL is empty', async () => {
    const result = await fetchWithFake(new FakeFetchProvider(okResult({ finalUrl: '' })))(
      { url: PUBLIC_IP_URL },
    )
    expect(result.url).toBe(PUBLIC_IP_URL)
  })

  it('maps the library truncated flag to the seam truncation', async () => {
    const result = await fetchWithFake(new FakeFetchProvider(okResult({ truncated: true })))(
      { url: PUBLIC_IP_URL },
    )
    expect(result.truncated).toBe(true)
  })

  it('maps the library overflow flag to the seam truncation', async () => {
    const result = await fetchWithFake(new FakeFetchProvider(okResult({ overflow: true })))(
      { url: PUBLIC_IP_URL },
    )
    expect(result.truncated).toBe(true)
  })

  it('reports a missing status as 0 on a success result', async () => {
    const result = await fetchWithFake(new FakeFetchProvider(okResult({ statusCode: null })))(
      { url: PUBLIC_IP_URL },
    )
    expect(result.statusCode).toBe(0)
  })

  it('refuses a non-TLS target by default as WEB_BLOCKED_URL', async () => {
    const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: 'http://127.0.0.1:8080/' }))
    expect(error.code).toBe('WEB_BLOCKED_URL')
    expect(error.message).toContain('http URLs are not allowed')
  })

  it('refuses a loopback target as WEB_BLOCKED_URL', async () => {
    const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: 'https://127.0.0.1:8443/' }))
    expect(error.code).toBe('WEB_BLOCKED_URL')
    expect(error.message).toContain('non-global address')
  })

  it('refuses a private-range target as WEB_BLOCKED_URL', async () => {
    const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: 'https://10.0.0.5/' }))
    expect(error.code).toBe('WEB_BLOCKED_URL')
    expect(error.message).toContain('non-global address')
  })

  it('allows the http scheme but still refuses the loopback address', async () => {
    const error = await rejected(provider({ allowHttp: true }).fetch({ url: 'http://127.0.0.1:8080/' }))
    expect(error.code).toBe('WEB_BLOCKED_URL')
    expect(error.message).toContain('non-global address')
  })

  it('refuses a malformed URL as WEB_BLOCKED_URL', async () => {
    const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: 'not a url' }))
    expect(error.code).toBe('WEB_BLOCKED_URL')
    expect(error.message).toContain('malformed URL')
  })

  it('refuses a blank URL as WEB_INVALID_URL', async () => {
    const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: '' }))
    expect(error.code).toBe('WEB_INVALID_URL')
    expect(error.message).toContain('No URL provided.')
  })

  it('surfaces a category without a message with the fallback text', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockResolvedValue(okResult({
      errorCategory: 'network',
      errorMessage: null,
    }))
    try {
      const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL }))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toBe('websift fetch failed (network)')
    } finally {
      spy.mockRestore()
    }
  })

  it('maps the timeout category to WEB_FETCH_TIMEOUT', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockResolvedValue(okResult({
      errorCategory: 'timeout',
      errorMessage: 'Fetch failed: request timed out.',
    }))
    try {
      const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL }))
      expect(error.code).toBe('WEB_FETCH_TIMEOUT')
      expect(error.message).toBe('Fetch failed: request timed out.')
    } finally {
      spy.mockRestore()
    }
  })

  it('maps the overflow category to WEB_FETCH_TOO_LARGE', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockResolvedValue(okResult({
      errorCategory: 'overflow',
      errorMessage: 'Fetch failed: response exceeded the byte cap.',
    }))
    try {
      const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL }))
      expect(error.code).toBe('WEB_FETCH_TOO_LARGE')
    } finally {
      spy.mockRestore()
    }
  })

  it('maps the unsupported-content category to WEB_UNSUPPORTED_CONTENT_TYPE', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockResolvedValue(okResult({
      errorCategory: 'unsupported_content',
      errorMessage: 'Fetch failed: unsupported content type.',
    }))
    try {
      const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL }))
      expect(error.code).toBe('WEB_UNSUPPORTED_CONTENT_TYPE')
    } finally {
      spy.mockRestore()
    }
  })

  it('maps an unexpected client rejection to WEB_PROVIDER_ERROR', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockRejectedValue(new Error('orchestrator exploded'))
    try {
      const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL }))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toBe('websift fetch failed: Error: orchestrator exploded')
    } finally {
      spy.mockRestore()
    }
  })

  it('does not dispatch for a pre-aborted call', async () => {
    const fake = new FakeFetchProvider(okResult())
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    const error = await rejected(provider({
      clientFactory: () => new WebSearchClient({ provider: fake }),
    }).fetch({ url: PUBLIC_IP_URL }, controller.signal))
    expect(error.code).toBe('WEB_ABORTED')
    expect(fake.requested).toBeUndefined()
  })

  it('aborts a live fetch as WEB_ABORTED while the backend keeps running', async () => {
    const controller = new AbortController()
    const fetch = provider({
      clientFactory: () => new WebSearchClient({ provider: new StalledFetchProvider() }),
    }).fetch({ url: PUBLIC_IP_URL }, controller.signal)
    controller.abort(new Error('deadline'))
    await expect(fetch).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('observes a signal that aborts synchronously while the call is built', async () => {
    const controller = new AbortController()
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockImplementation(() => {
      controller.abort(new Error('sync abort'))
      return new Promise(() => {})
    })
    try {
      const error = await rejected(provider({
        clientFactory: () => new WebSearchClient({}),
      }).fetch({ url: PUBLIC_IP_URL }, controller.signal))
      expect(error.code).toBe('WEB_ABORTED')
      expect(error.cause).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })

  it('resolves under an active signal the backend settles before aborting', async () => {
    const controller = new AbortController()
    const result = await fetchWithFake(new FakeFetchProvider(okResult()))({ url: PUBLIC_IP_URL }, controller.signal)
    expect(result.body.content).toBe('Rendered markdown')
  })

  it('surfaces a backend rejection under an active signal as WEB_PROVIDER_ERROR', async () => {
    const controller = new AbortController()
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockRejectedValue(new Error('backend down'))
    try {
      const error = await rejected(provider({
        clientFactory: () => new WebSearchClient({}),
      }).fetch({ url: PUBLIC_IP_URL }, controller.signal))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toBe('websift fetch failed: Error: backend down')
    } finally {
      spy.mockRestore()
    }
  })

  it('maps an abort-shaped rejection without a signal to WEB_ABORTED carrying the rejection', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockRejectedValue(new DOMException('aborted', 'AbortError'))
    try {
      const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL }))
      expect(error.code).toBe('WEB_ABORTED')
      expect(error.cause).toBeInstanceOf(DOMException)
    } finally {
      spy.mockRestore()
    }
  })

  it('maps a non-abort DOMException rejection to WEB_PROVIDER_ERROR', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockRejectedValue(new DOMException('fetch failed', 'NetworkError'))
    try {
      const error = await rejected(provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL }))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toContain('websift fetch failed')
    } finally {
      spy.mockRestore()
    }
  })

  it('builds the real client when no test factory is supplied', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockResolvedValue(okResult())
    try {
      const result = await provider(POLICY_OPTIONS).fetch({ url: PUBLIC_IP_URL })
      expect(result).toEqual({
        url: PUBLIC_IP_URL,
        statusCode: 200,
        body: { kind: 'text', content: 'Rendered markdown' },
        truncated: false,
      })
    } finally {
      spy.mockRestore()
    }
  })
})

describe('web-fetch-websift plugin registration', () => {
  it('carries the shipped keyless defaults on the config schema', () => {
    expect(Config({})).toEqual({ allowHttp: false, timeoutMs: 30_000, maxPageChars: 128_000 })
  })

  it('serves the config defaults when apply receives a raw empty entry', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockResolvedValue(okResult())
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, {})
      apply(ctx, {})
      const result = await ctx.web.fetch({ url: PUBLIC_IP_URL })
      expect(result).toEqual({
        url: PUBLIC_IP_URL,
        statusCode: 200,
        body: { kind: 'text', content: 'Rendered markdown' },
        truncated: false,
      })
      await ctx.fiber.dispose()
    } finally {
      spy.mockRestore()
    }
  })

  it('serves the configured fetch provider the seam selects explicitly', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'fetchStructured').mockResolvedValue(okResult())
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { fetchProvider: 'websift' })
      apply(ctx, { allowHttp: true, timeoutMs: 15_000, maxPageChars: 64_000 })
      const result = await ctx.web.fetch({ url: PUBLIC_IP_URL })
      expect(result.statusCode).toBe(200)
      await ctx.fiber.dispose()
    } finally {
      spy.mockRestore()
    }
  })

  it('fails loud at load on a non-positive or fractional timeout', () => {
    const ctx = new Context()
    expect(() => apply(ctx, { timeoutMs: 0 })).toThrow('timeoutMs must be a positive finite number')
    expect(() => apply(ctx, { timeoutMs: -1 })).toThrow('timeoutMs must be a positive finite number')
    expect(() => apply(ctx, { timeoutMs: Number.NaN })).toThrow('timeoutMs must be a positive finite number')
  })

  it('fails loud at load on a non-positive or fractional page cap', () => {
    const ctx = new Context()
    expect(() => apply(ctx, { maxPageChars: 0 })).toThrow('maxPageChars must be a positive integer')
    expect(() => apply(ctx, { maxPageChars: 12.5 })).toThrow('maxPageChars must be a positive integer')
  })
})
