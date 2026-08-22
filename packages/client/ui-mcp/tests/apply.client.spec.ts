// @vitest-environment jsdom
/**
 * Registration: the MCP settings section and the /mcp decoration come from
 * one apply. The section defers until its slot is declared, the decoration
 * waits on the commandUi service, and both fold up on fiber disposal.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { CommandDecoration } from '@deepseek-ai/dsh-client-ui-commands/client'
import { apply, inject } from '../src/client/index.ts'
import { McpSection } from '../src/client/McpSection.tsx'
import type { McpSectionState } from '../src/client/section-store.ts'

// The section nav label is asserted in Chinese; state the browser assumed.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('connection', {
    api: {
      mcp: {
        list: () => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: { servers: [] } } }),
        add: () => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: { serverName: 'x' } } }),
        remove: () => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: {} } }),
        reconnect: () => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: {} } }),
      },
    },
  } as never)
  ctx.provide('settingsPanel', {
    openSection: () => undefined,
    close: () => undefined,
    setActiveId: () => undefined,
    store: { getSnapshot: () => ({ open: false, activeId: undefined }), subscribe: () => () => undefined },
  } as never)
  const decorated: CommandDecoration[] = []
  ctx.provide('commandUi', {
    register() { throw new Error('ui-mcp registers no client contributions') },
    decorate(decoration: CommandDecoration) {
      decorated.push(decoration)
      return () => {
        const at = decorated.indexOf(decoration)
        if (at >= 0) decorated.splice(at, 1)
      }
    },
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, decorated }
}

function declareSectionSlot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-mcp apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the section once its slot is declared, and the decoration regardless', async () => {
    const { ctx, slots, decorated } = await bench()
    await ctx.plugin({ inject: [...inject, 'commandUi', 'settingsPanel'], apply }).await()

    // The decoration waits only on its services; the section waits on the slot.
    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(decorated.map(entry => entry.name)).toEqual(['mcp'])

    declareSectionSlot(slots)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(McpSection)
    expect(section.options).toMatchObject({ id: 'mcp', order: 40 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('MCP 服务器')
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject, 'commandUi', 'settingsPanel'], apply }).await()

    declareSectionSlot(slots)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('hands the section its own store and actions', async () => {
    const { ctx, slots } = await bench()
    declareSectionSlot(slots)
    await ctx.plugin({ inject: [...inject, 'commandUi', 'settingsPanel'], apply }).await()
    const section = slots.entries('settings.section')[0]!
    const injected = section.inject?.() as {
      hooks: { mcpSection: { getSnapshot: () => McpSectionState } }
      load: () => Promise<void>
      beginAdd: () => void
      cancelAdd: () => void
      setAddField: (field: string, value: string) => void
      submitAdd: () => Promise<void>
      beginRemove: (name: string | null) => void
      setRemoveAcknowledged: (acknowledged: boolean) => void
      remove: () => Promise<void>
      reconnect: (name: string) => Promise<void>
    }
    expect(injected.hooks.mcpSection.getSnapshot()).toMatchObject({ status: 'idle', rows: [] })
    await injected.load()
    expect(injected.hooks.mcpSection.getSnapshot()).toMatchObject({ status: 'ready' })
    injected.beginAdd()
    expect(injected.hooks.mcpSection.getSnapshot().add).not.toBeNull()
    injected.setAddField('serverName', 'new')
    expect(injected.hooks.mcpSection.getSnapshot().add?.serverName).toBe('new')
    await injected.submitAdd()
    injected.cancelAdd()
    expect(injected.hooks.mcpSection.getSnapshot().add).toBeNull()
    injected.beginRemove('websift')
    injected.setRemoveAcknowledged(true)
    await injected.remove()
    expect(injected.hooks.mcpSection.getSnapshot().pendingRemove).toBeNull()
    await injected.reconnect('websift')
    expect(injected.hooks.mcpSection.getSnapshot().reconnecting).toBeNull()
  })

  it('registers the section only after a late declaration and folds it up on disposal', async () => {
    const { ctx, slots, decorated } = await bench()
    declareSectionSlot(slots)
    const fiber = ctx.plugin({ inject: [...inject, 'commandUi', 'settingsPanel'], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(1)
    expect(decorated).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(decorated).toHaveLength(0)
  })
})
