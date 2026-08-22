/**
 * Unit behavior of the websift-backed provider: seam mapping, cancellation,
 * and errors. Mapping tests drive the real `WebSearchClient` against a fake
 * backend object (websift accepts a provider object as well as a name), so no
 * network is touched; the local SearXNG double at the bottom exercises the
 * real name-path wire end to end.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createProviderCapabilities,
  ProviderTimeoutError,
  WebSearchClient,
  type SearchProvider,
  type SearchRequest,
  type SearchResult,
} from 'websift'
import {
  apply,
  WEBSIFT_PROVIDER_ID,
  WebsiftSearchProvider,
  type WebsiftSearchProviderOptions,
} from '@deepseek-ai/dsh-web-search-websift'
import WebRuntime, { type WebSearchResult } from '@deepseek-ai/dsh-web'

/** A provider whose outcome is fixed; records the request it received. */
class FakeProvider implements SearchProvider {
  readonly name = 'fake'
  readonly capabilities = createProviderCapabilities()
  requested: SearchRequest | undefined

  constructor(private readonly outcome: SearchResult[] | ProviderTimeoutError) {}

  async search(request: SearchRequest): Promise<SearchResult[]> {
    this.requested = request
    if (this.outcome instanceof ProviderTimeoutError) throw this.outcome
    return this.outcome
  }

  fetch(): never {
    throw new Error('fake fetch is not used by the search path')
  }
}

/** A provider that never settles, for observing cancellation of a live call. */
class StalledProvider implements SearchProvider {
  readonly name = 'stalled'
  readonly capabilities = createProviderCapabilities()

  search(): Promise<SearchResult[]> {
    return new Promise<SearchResult[]>(() => {})
  }

  fetch(): never {
    throw new Error('fake fetch is not used by the search path')
  }
}

/** Build the provider over a fixed options value; production passes a live thunk. */
function provider(options: WebsiftSearchProviderOptions): WebsiftSearchProvider {
  return new WebsiftSearchProvider(() => options)
}

/** Seed one real client with a fake backend for the search path. */
function clientWithFake(
  fake: SearchProvider,
): (request: { query: string; maxResults?: number }, signal?: AbortSignal) => Promise<WebSearchResult> {
  return (request, signal) => provider({
    provider: 'ddgs',
    allowHttp: false,
    clientFactory: webRequest => new WebSearchClient({
      provider: fake,
      ...webRequest.maxResults !== undefined ? { maxResults: webRequest.maxResults } : {},
    }),
  }).search(request, signal)
}

const RESULTS: SearchResult[] = [
  { title: 'Alpha', url: 'https://alpha.test', snippet: 'first snippet', rank: 1, source: 'fake' },
  { title: '', url: 'https://beta.test', snippet: '', rank: 2, source: 'fake' },
  { title: 'No URL', url: '', snippet: 'dropped', rank: 3, source: 'fake' },
]

async function rejected(error: Promise<unknown>): Promise<{ code: string | undefined; message: string; cause: unknown }> {
  return await error.then(
    () => { throw new Error('expected the search to reject') },
    (cause: unknown) => ({
      code: (cause as { code?: string }).code,
      message: (cause as Error).message,
      cause: (cause as { cause?: unknown }).cause,
    }),
  )
}

describe('WebsiftSearchProvider', () => {
  it('registers the stable seam id', () => {
    expect(provider({ provider: 'ddgs', allowHttp: false }).id).toBe(WEBSIFT_PROVIDER_ID)
  })

  it('reports availability without network: ddgs always, searxng only with a parseable endpoint', () => {
    expect(provider({ provider: 'ddgs', allowHttp: false }).available()).toBe(true)
    expect(provider({ provider: 'searxng', allowHttp: true }).available()).toBe(false)
    expect(provider({ provider: 'searxng', baseUrl: 'not a url', allowHttp: true }).available()).toBe(false)
    expect(provider({ provider: 'searxng', baseUrl: 'http://127.0.0.1:8888', allowHttp: true }).available()).toBe(true)
  })

  it('maps structured results to seam sources, omitting empty fields', async () => {
    const result = await clientWithFake(new FakeProvider(RESULTS))({ query: 'q' })
    expect(result).toEqual({
      sources: [
        { url: 'https://alpha.test', title: 'Alpha', snippet: 'first snippet' },
        { url: 'https://beta.test' },
      ],
      truncated: false,
    })
  })

  it('forwards the query and the seam result bound to the backend', async () => {
    const fake = new FakeProvider(RESULTS)
    const search = clientWithFake(fake)
    const result = await search({ query: 'deepseek harness', maxResults: 7 })
    expect(result.sources.length).toBe(2)
    expect(fake.requested).toEqual({ query: 'deepseek harness', maxResults: 7 })
  })

  it('returns no sources when the backend returns nothing', async () => {
    const result = await clientWithFake(new FakeProvider([]))({ query: 'q' })
    expect(result).toEqual({ sources: [], truncated: false })
  })

  it('surfaces a provider error category as WEB_PROVIDER_ERROR with the sanitized message', async () => {
    const fake = clientWithFake(new FakeProvider(new ProviderTimeoutError('timed out', { provider: 'fake' })))
    const error = await rejected(fake({ query: 'q' }))
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toContain('Search failed')
  })

  it('falls back to a category message when the response carries none', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockResolvedValue({
      request: { query: 'q', maxResults: 5 },
      results: [],
      errorCategory: 'rate_limit',
      errorMessage: null,
    })
    try {
      const error = await rejected(clientWithFake(new FakeProvider([]))({ query: 'q' }))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toBe('websift search failed (rate_limit)')
    } finally {
      spy.mockRestore()
    }
  })

  it('maps an unexpected client rejection to WEB_PROVIDER_ERROR', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockRejectedValue(new Error('orchestrator exploded'))
    try {
      const error = await rejected(clientWithFake(new FakeProvider([]))({ query: 'q' }))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toBe('websift search failed: Error: orchestrator exploded')
    } finally {
      spy.mockRestore()
    }
  })

  it('does not dispatch for a pre-aborted call', async () => {
    const fake = new FakeProvider(RESULTS)
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    const error = await rejected(provider({
      provider: 'ddgs',
      allowHttp: false,
      clientFactory: () => new WebSearchClient({ provider: fake }),
    }).search({ query: 'q' }, controller.signal))
    expect(error.code).toBe('WEB_ABORTED')
    expect(fake.requested).toBeUndefined()
  })

  it('aborts a live search as WEB_ABORTED while the backend keeps running', async () => {
    const controller = new AbortController()
    const search = provider({
      provider: 'ddgs',
      allowHttp: false,
      clientFactory: () => new WebSearchClient({ provider: new StalledProvider() }),
    }).search({ query: 'q' }, controller.signal)
    controller.abort(new Error('deadline'))
    await expect(search).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('observes a signal that aborts synchronously while the call is built', async () => {
    const controller = new AbortController()
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockImplementation(() => {
      controller.abort(new Error('sync abort'))
      return new Promise(() => {})
    })
    try {
      const error = await rejected(provider({
        provider: 'ddgs',
        allowHttp: false,
        clientFactory: () => new WebSearchClient({}),
      }).search({ query: 'q' }, controller.signal))
      expect(error.code).toBe('WEB_ABORTED')
      expect(error.cause).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })

  it('builds the real ddgs client when no test factory is supplied', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockResolvedValue({
      request: { query: 'q', maxResults: 5 },
      results: [],
      errorCategory: null,
      errorMessage: null,
    })
    try {
      const result = await provider({ provider: 'ddgs', allowHttp: false }).search({ query: 'q' })
      expect(result).toEqual({ sources: [], truncated: false })
    } finally {
      spy.mockRestore()
    }
  })

  it('resolves under an active signal the backend settles before aborting', async () => {
    const controller = new AbortController()
    const result = await clientWithFake(new FakeProvider(RESULTS))({ query: 'q' }, controller.signal)
    expect(result.sources.length).toBe(2)
  })

  it('surfaces a backend failure under an active signal as WEB_PROVIDER_ERROR', async () => {
    const controller = new AbortController()
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockRejectedValue(new Error('backend down'))
    try {
      const error = await rejected(provider({
        provider: 'ddgs',
        allowHttp: false,
        clientFactory: () => new WebSearchClient({}),
      }).search({ query: 'q' }, controller.signal))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toBe('websift search failed: Error: backend down')
    } finally {
      spy.mockRestore()
    }
  })

  it('maps an abort-shaped rejection without a signal to WEB_ABORTED carrying the rejection', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockRejectedValue(new DOMException('aborted', 'AbortError'))
    try {
      const error = await rejected(clientWithFake(new FakeProvider([]))({ query: 'q' }))
      expect(error.code).toBe('WEB_ABORTED')
      expect(error.cause).toBeInstanceOf(DOMException)
    } finally {
      spy.mockRestore()
    }
  })

  it('maps a non-abort DOMException rejection to WEB_PROVIDER_ERROR', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockRejectedValue(new DOMException('fetch failed', 'NetworkError'))
    try {
      const error = await rejected(clientWithFake(new FakeProvider([]))({ query: 'q' }))
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toContain('websift search failed')
    } finally {
      spy.mockRestore()
    }
  })

  it('serves the keyless defaults when apply receives a raw empty entry', async () => {
    const spy = vi.spyOn(WebSearchClient.prototype, 'searchStructured').mockResolvedValue({
      request: { query: 'q', maxResults: 5 },
      results: [],
      errorCategory: null,
      errorMessage: null,
    })
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, {})
      apply(ctx, {})
      const result = await ctx.web.search({ query: 'q' })
      expect(result).toEqual({ sources: [], truncated: false })
      await ctx.fiber.dispose()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('WebsiftSearchProvider over a local SearXNG double', () => {
  let server: Server
  let base: string
  const requests: { url: string; method: string }[] = []

  const results = (count: number): { results: { title: string; url: string; content: string }[] } => ({
    results: Array.from({ length: count }, (_value, index) => ({
      title: `Result ${index + 1}`,
      url: `https://result-${index + 1}.example.test`,
      content: `Snippet ${index + 1}`,
    })),
  })

  async function start(double: (req: IncomingMessage, res: ServerResponse) => void): Promise<void> {
    requests.length = 0
    server = createServer((req, res) => {
      requests.push({ url: req.url ?? '', method: req.method ?? '' })
      double(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  }

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => { resolve() }))
  })

  const search = (baseUrl: string, request: { query: string; maxResults?: number }): Promise<WebSearchResult> =>
    provider({ provider: 'searxng', baseUrl, allowHttp: true }).search(request)

  it('searches the configured endpoint through the real library wire', async () => {
    await start((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(results(3)))
    })
    const result = await search(base, { query: 'harness', maxResults: 8 })
    expect(result.truncated).toBe(false)
    expect(result.sources.map(source => source.url)).toEqual([
      'https://result-1.example.test',
      'https://result-2.example.test',
      'https://result-3.example.test',
    ])
    expect(result.sources[0]).toEqual({
      url: 'https://result-1.example.test',
      title: 'Result 1',
      snippet: 'Snippet 1',
    })
    const [request] = requests
    if (request === undefined) throw new Error('the double received no request')
    expect(request.method).toBe('GET')
    const params = new URL(request.url, base).searchParams
    expect(params.get('q')).toBe('harness')
    expect(params.get('format')).toBe('json')
    expect(params.get('number_of_results')).toBe('8')
  })

  it('surfaces a repeated 500 as WEB_PROVIDER_ERROR after the library retry', async () => {
    await start((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{}')
    })
    const error = await rejected(search(base, { query: 'harness' }))
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toContain('Provider unavailable')
    expect(requests.length).toBe(2)
  })
})
