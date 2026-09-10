// @vitest-environment jsdom
/**
 * Local DOM snapshots of the sidebar shell through the real assembly path:
 * SlotTestRuntime mounts the package apply on its own fiber, the auto frame
 * supplies the layout's owner share at the render site, and the snapshot
 * captures exactly the 'sidebar' slot's output (CSS-module class names
 * folded to their semantic locals by the runtime's serializer). The child
 * holes (sidebar.workspaces / sidebar.settings) have no registrant here, so
 * the snapshots pin the shell chrome itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@open-harness/oh-client-test-runtime'
import { LocaleRuntime } from '@open-harness/oh-client-locale/client'
import { apply, inject } from '@open-harness/oh-client-ui-sidebar/client'

afterEach(cleanup)

/**
 * Boot the package over the slot test runtime. The default bench pins the
 * shipped Chinese copy; `locale: 'en'` pins the en copy instead. The
 * installed face backs the entry's standard `t` seat either way.
 */
async function bench(options: { locale?: 'en' } = {}) {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('layout', { toggleSidebar: vi.fn(), setCenterView: vi.fn() })
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale(options.locale === 'en' ? 'en' : 'zh')
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({
    'sidebar': { kind: 'single', scope: 'root' },
    'shell.header': { kind: 'single', scope: 'root' },
  })
  await runtime.mount({ inject: [...inject], apply })
  return { runtime, locale }
}

describe('sidebar shell snapshots', () => {
  it('renders the expanded column in the zh copy (no nav: the header owns it)', async () => {
    const { runtime } = await bench()
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    // Default tab is Chats: the New button starts a chat, and the
    // brand/wordmark no longer lives in the column (it is the header's).
    expect(slot.view.getAllByRole('button', { name: '新建聊天' })).toHaveLength(1)
    expect(slot.view.queryAllByRole('tab')).toHaveLength(0)
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })

  it('renders the expanded column (toggle, New button, empty holes)', async () => {
    const { runtime } = await bench({ locale: 'en' })
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    // Default tab is Chats: the New button starts a chat; the nav
    // tabs live in the header, so the column carries no tablist.
    expect(slot.view.getByRole('button', { name: 'New chat' })).toBeTruthy()
    expect(slot.view.queryAllByRole('tab')).toHaveLength(0)
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })

  it('renders the collapsed rail after the crossfade settles, in place', async () => {
    const { runtime } = await bench({ locale: 'en' })
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    const shell = slot.container.firstElementChild
    slot.update({ collapsed: true, width: 56 })
    // The wide content unmounts at the 150ms settle; only the rail's capsule
    // remains a New-chat button.
    await waitFor(() => {
      expect(slot.view.getAllByRole('button', { name: 'New chat' })).toHaveLength(1)
    })
    expect(slot.container).toMatchSnapshot()
    // Same tree position: the owner flip re-rendered the shell in place.
    expect(slot.container.firstElementChild).toBe(shell)
    await runtime.dispose()
  })

  it('a locale switch refreshes mounted copy without re-registration', async () => {
    const { runtime, locale } = await bench()
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    expect(slot.view.getAllByRole('button', { name: '新建聊天' })).toHaveLength(1)
    // Same fiber, same registration: setLocale alone re-renders the outlet.
    act(() => { locale.setLocale('en') })
    expect(slot.view.getAllByRole('button', { name: 'New chat' })).toHaveLength(1)
    expect(slot.view.queryByRole('button', { name: '新建聊天' })).toBeNull()
    await runtime.dispose()
  })
})
