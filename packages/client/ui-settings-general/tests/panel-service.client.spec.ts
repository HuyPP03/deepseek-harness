/** Settings panel controller: the store's open state and section selection, and its deep-link actions. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsPanelController } from '../src/client/panel-service.ts'
import type { SettingsPanelState } from '../src/client/panel-service.ts'

async function bench() {
  const ctx = new Context()
  const fiber = await ctx.plugin(SettingsPanelController).await()
  const panel = ctx.get('settingsPanel') as SettingsPanelController
  return { ctx, fiber, panel, store: panel.store }
}

describe('SettingsPanelController', () => {
  it('registers as the settingsPanel service with the closed initial state', async () => {
    const { ctx, fiber, store } = await bench()
    expect(fiber.state).toBe(2 /* ACTIVE */)
    expect(ctx.get('settingsPanel')).toBeInstanceOf(SettingsPanelController)
    expect(store.getSnapshot()).toEqual({ open: false, activeId: undefined })
    // Snapshot identity is stable until a mutation moves the state.
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('openSection opens the panel and selects the given section, or keeps the selection', async () => {
    const { panel, store } = await bench()
    panel.openSection()
    expect(store.getSnapshot()).toEqual({ open: true, activeId: undefined })
    panel.openSection('models')
    expect(store.getSnapshot()).toEqual({ open: true, activeId: 'models' })
    // An open without an id keeps the current selection.
    panel.openSection()
    expect(store.getSnapshot()).toEqual({ open: true, activeId: 'models' })
  })

  it('setActiveId selects a section without touching the open state', async () => {
    const { panel, store } = await bench()
    panel.openSection('general')
    panel.setActiveId('mcp')
    expect(store.getSnapshot()).toEqual({ open: true, activeId: 'mcp' })
    // On a closed panel the same action keeps the panel closed.
    const closed = await bench()
    closed.panel.setActiveId('mcp')
    expect(closed.store.getSnapshot()).toEqual({ open: false, activeId: 'mcp' })
  })

  it('close drops the open state and the selection', async () => {
    const { panel, store } = await bench()
    panel.openSection('models')
    panel.close()
    expect(store.getSnapshot()).toEqual({ open: false, activeId: undefined })
  })

  it('notifies subscribers with a fresh snapshot on every mutation', async () => {
    const { panel, store } = await bench()
    const seen: SettingsPanelState[] = []
    const off = store.subscribe(() => { seen.push(store.getSnapshot()) })
    panel.openSection('models')
    panel.setActiveId('mcp')
    panel.close()
    expect(seen).toEqual([
      { open: true, activeId: 'models' },
      { open: true, activeId: 'mcp' },
      { open: false, activeId: undefined },
    ])
    // Distinct snapshot objects per move.
    expect(new Set(seen).size).toBe(3)
    off()
    panel.openSection()
    expect(seen).toHaveLength(3)
  })

  it('unloads with the owning fiber', async () => {
    const { ctx, fiber } = await bench()
    await fiber.dispose()
    expect(fiber.state).toBe(4 /* DISPOSED */)
    expect(ctx.get('settingsPanel')).toBeUndefined()
  })
})
