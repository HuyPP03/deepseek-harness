// @vitest-environment jsdom
/**
 * ui-job plugin halves: the browser entry's dictionary and composer-tool-row
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry, and the invariant companion's
 * ownership reservation.
 */
import { Context } from '@open-harness/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@open-harness/oh-invariants'
import { SlotRegistry } from '@open-harness/oh-client-runtime/client'
import { stubSettingsScope } from '@open-harness/oh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@open-harness/oh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as JobInvariant from '../src/invariant.ts'
import { en, NS, vi, zh } from '../src/client/locales.ts'

/** Slot ledger reader: entry ids currently registered in the composer tool row. */
function composerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.input.right')
    .map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the composer tool row. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.right': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  ctx.provide('sessions', {})
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-job browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'slots', 'locale', 'connection'])
  })

  it('registers the composer tool-row action, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(composerEntryIds(ctx)).toContain('job-list')
    await fiber.dispose()
    expect(composerEntryIds(ctx)).not.toContain('job-list')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('list.aria')).toBe(zh['list.aria'])
    ctx.locale.setLocale('en')
    expect(translate('list.aria')).toBe(en['list.aria'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('list.aria')).not.toBe(en['list.aria'])
  })

  it('keeps every locale dictionary key-identical to the English source of truth', () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})

describe('ui-job node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('ui-job invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(JobInvariant)
    await fiber.await()
    expect(JobInvariant.name).toBe('client-ui-jobs-invariant')
    expect(JobInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
