/**
 * The `web-search-websift` settings section layered over the composition
 * entry: the provider serves the section it started on, a stored change
 * reaches the next search without re-registration, and detach/unload fall
 * back or release cleanly. Searches run against local SearXNG doubles, so the
 * section's endpoint is observable per request.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as websiftPlugin from '@deepseek-ai/dsh-web-search-websift'
import { WEBSIFT_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web-search-websift'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** A SearXNG-shaped double that counts the searches it served. */
class SearxngDouble {
  base = ''
  hits = 0
  private readonly server: Server

  constructor() {
    this.server = createServer((_req, res) => {
      this.hits += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        results: [{ title: 'Double hit', url: 'https://double.test/hit', content: 'from the double' }],
      }))
    })
  }

  async listen(): Promise<void> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    const { port } = this.server.address() as AddressInfo
    this.base = `http://127.0.0.1:${port}`
  }

  async close(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => { resolve() }))
  }
}

async function boot(config: Record<string, unknown>): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, {})
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(websiftPlugin, { allowHttp: true, ...config })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

describe('web-search-websift settings section', () => {
  let a: SearxngDouble
  let b: SearxngDouble

  beforeEach(async () => {
    a = new SearxngDouble()
    await a.listen()
    b = new SearxngDouble()
    await b.listen()
  })

  afterEach(async () => {
    await a.close()
    await b.close()
  })

  it('serves a stored endpoint to the next search without re-registering the provider', async () => {
    const bench = await boot({ provider: 'searxng', baseUrl: a.base })
    await bench.ctx.web.search({ query: 'anything' })
    expect(a.hits).toBe(1)
    expect(b.hits).toBe(0)

    await bench.ctx.settings.update(WEBSIFT_SETTINGS_NAMESPACE, { baseUrl: b.base })

    await bench.ctx.web.search({ query: 'anything' })
    expect(a.hits).toBe(1)
    expect(b.hits).toBe(1)
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot({ provider: 'searxng', baseUrl: a.base })
    await bench.ctx.settings.update(WEBSIFT_SETTINGS_NAMESPACE, { baseUrl: b.base })
    await bench.ctx.web.search({ query: 'anything' })
    expect(b.hits).toBe(1)

    await bench.settingsFiber.dispose()

    await bench.ctx.web.search({ query: 'anything' })
    expect(a.hits).toBe(1)
    expect(b.hits).toBe(1)
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace and the provider when the plugin unloads', async () => {
    const bench = await boot({ provider: 'ddgs' })
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-websift')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-search-websift')
    await expect(bench.ctx.web.search({ query: 'anything' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
    await bench.ctx.fiber.dispose()
  })

  it('serves the composition entry in a composition without a settings service', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    const pluginFiber = ctx.plugin(websiftPlugin, { provider: 'searxng', baseUrl: a.base, allowHttp: true })
    await pluginFiber.await()

    await ctx.web.search({ query: 'anything' })
    expect(a.hits).toBe(1)
    await ctx.fiber.dispose()
  })

  it('ignores an empty stored endpoint on the keyless section', async () => {
    const bench = await boot({ provider: 'ddgs' })
    await bench.ctx.settings.update(WEBSIFT_SETTINGS_NAMESPACE, { baseUrl: '' })
    const controller = new AbortController()
    controller.abort(new Error('no dispatch needed'))
    await expect(bench.ctx.web.search({ query: 'anything' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    await bench.ctx.fiber.dispose()
  })

  it('refuses an unknown backend at load', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    await ctx.plugin(MemorySettings)
    await expect(ctx.plugin(websiftPlugin, { provider: 'brave' }))
      .rejects.toThrow(/unknown search provider "brave"/)
    await ctx.fiber.dispose()
  })

  it('refuses searxng without an endpoint at load', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    await ctx.plugin(MemorySettings)
    await expect(ctx.plugin(websiftPlugin, { provider: 'searxng' }))
      .rejects.toThrow(/provider "searxng" requires a baseUrl/)
    await ctx.fiber.dispose()
  })
})
