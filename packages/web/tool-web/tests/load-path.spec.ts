/**
 * Real Loader-path guard for an injected namespace plugin. A default export would make
 * `unwrapExports` collapse the namespace and drop `inject`, causing access to `ctx.web` to fail.
 * Hand-built mounting bypasses that path, so this test unwraps through the real Loader first; see
 * postmortem 0001.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@open-harness/cordis'
import Loader from '@open-harness/cordis-plugin-loader'
import SystemPrompt from '@open-harness/oh-system-prompt'
import ToolRuntime from '@open-harness/oh-tools'
import WebRuntime from '@open-harness/oh-web'
import * as toolWeb from '@open-harness/oh-tool-web'

describe('oh-tool-web real-load-path guard', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in toolWeb).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolWeb) as Record<string, unknown>
    expect(unwrapped).toBe(toolWeb)
    expect(unwrapped.name).toBe('tool-web')
    expect(unwrapped.inject).toEqual(['tools', 'web', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('boots over ctx.web through the unwrapped module without an inject error', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime, {})

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolWeb) as Parameters<Context['plugin']>[0]
    // Mounting the collapsed shape would throw for missing injection here.
    const fiber = await ctx.plugin(unwrapped)
    expect(ctx.tools.schemas().map(s => s.name)).toEqual(expect.arrayContaining(['web_search', 'web_fetch']))
    await fiber.dispose()
  })
})
