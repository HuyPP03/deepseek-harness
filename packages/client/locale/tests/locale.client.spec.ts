// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@open-harness/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@open-harness/oh-client-test-runtime'
import type { LocaleSettings, LocaleSnapshot } from '@open-harness/oh-client-locale/client'
import { LocaleRuntime } from '@open-harness/oh-client-locale/client'

const make = (host?: StubSettingsScope<LocaleSettings>): {
  ctx: Context
  svc: LocaleRuntime
  events: LocaleSnapshot[]
} => {
  const ctx = new Context()
  const events: LocaleSnapshot[] = []
  ctx.on('locale/change', (snapshot) => { events.push(snapshot) })
  return { ctx, svc: new LocaleRuntime(ctx, host?.scope), events }
}

/**
 * Stub the browser language the product deliberately ignores: specs use it to
 * prove the English default is navigator-independent (zh/vi browsers included).
 */
const stubLanguages = (...tags: string[]): void => {
  vi.stubGlobal('navigator', { languages: tags, language: tags[0] ?? '' })
}

describe('LocaleRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('translates through the active-locale -> en -> key chain', () => {
    const { svc } = make()
    svc.setLocale('zh')
    svc.register('ns', 'zh', { hello: '你好', onlyZh: '仅中文' })
    svc.register('ns', 'en', { hello: 'Hello', onlyEn: 'Only en' })
    const t = svc.bind('ns')
    expect(svc.getLocale().active).toBe('zh')
    expect(t('hello')).toBe('你好')
    expect(t('onlyEn')).toBe('Only en')
    svc.setLocale('en')
    expect(t('hello')).toBe('Hello')
    expect(t('onlyZh')).toBe('onlyZh')
    expect(t('missing.key')).toBe('missing.key')
  })

  it('falls through to the common vocabulary after the namespace misses (production keys)', () => {
    const { svc } = make()
    svc.setLocale('zh')
    // The shipped common set is registered by apply; the bench registers it
    // directly to pin the production chain: ns -> common -> en -> key.
    svc.register('common', 'zh', { retry: '重试' })
    svc.register('common', 'en', { retry: 'Retry' })
    svc.register('ns', 'zh', { own: '自有' })
    svc.register('ns', 'en', { own: 'Own' })
    const t = svc.bind('ns')
    expect(t('retry')).toBe('重试')
    expect(t('own')).toBe('自有')
    svc.setLocale('en')
    expect(t('retry')).toBe('Retry')
    expect(t('own')).toBe('Own')
    // common itself must not recurse: a miss inside common echoes the key.
    // (Wide-string ns hits the untyped bind overload — the typed one rejects
    // unknown keys at compile time, which is the point of the typed registry contract.)
    expect(svc.bind('common' as string)('nope')).toBe('nope')
  })

  it('interpolates {name} params and leaves unknown placeholders intact', () => {
    const { svc } = make()
    svc.setLocale('zh')
    svc.register('ns', 'zh', { greet: '你好，{name}！第 {n} 次', partial: '{known} 与 {unknown}' })
    const t = svc.bind('ns')
    expect(t('greet', { name: '世界', n: 2 })).toBe('你好，世界！第 2 次')
    expect(t('partial', { known: 'A' })).toBe('A 与 {unknown}')
  })

  it('bind returns a stable per-namespace function identity', () => {
    const { svc } = make()
    expect(svc.bind('a')).toBe(svc.bind('a'))
    expect(svc.bind('a')).not.toBe(svc.bind('b'))
  })

  it('rejects duplicate (ns, locale) and disposer only removes its own dict', () => {
    const { svc } = make()
    svc.setLocale('zh')
    const dispose = svc.register('ns', 'zh', { k: 'v1' })
    expect(() => svc.register('ns', 'zh', { k: 'v2' })).toThrow('already has locale')
    dispose()
    const t = svc.bind('ns')
    expect(t('k')).toBe('k')
    svc.register('ns', 'zh', { k: 'v2' })
    expect(t('k')).toBe('v2')
    dispose()
    expect(t('k')).toBe('v2')
  })

  it('serves the LocaleFace: snapshot revision moves on switch and registration, subscribers fire, unsubscribe stops them', () => {
    const { svc } = make()
    const seen: number[] = []
    const off = svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
    expect(svc.getSnapshot()).toBe(svc.getLocale())
    const r0 = svc.getSnapshot().revision
    svc.register('ns', 'zh', { k: 'v' })
    expect(svc.getSnapshot().revision).toBe(r0 + 1)
    svc.setLocale('zh')
    expect(seen).toEqual([r0 + 1, r0 + 2])
    off()
    svc.setLocale('en')
    expect(seen).toHaveLength(2)
  })

  it('isolates a throwing subscriber: the rest still see the new revision', () => {
    const { svc } = make()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: number[] = []
      svc.subscribe(() => { throw new Error('boom') })
      svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
      svc.setLocale('zh')
      expect(seen).toEqual([1])
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('register disposer republishes (mounted outlets drop the dead dictionary)', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'zh', { k: 'v' })
    const before = svc.getSnapshot().revision
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
    // Second run hits the idempotent arm: nothing removed, no republish.
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
  })

  it('setLocale writes through the scope, republishes an immutable snapshot, and no-ops on same value', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    svc.setLocale('vi')
    expect(svc.getLocale().active).toBe('vi')
    expect(host.set).toHaveBeenCalledWith('preference', 'vi')
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(svc.getLocale())
    expect(events[0]!.revision).toBe(1)
    svc.setLocale('vi')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('setLocale without a host scope stays process-local', () => {
    const { svc, events } = make()
    svc.setLocale('zh')
    expect(svc.getLocale().active).toBe('zh')
    expect(events).toHaveLength(1)
  })

  it('throws on unknown locale ids', () => {
    const { svc } = make()
    expect(() => { svc.setLocale('fr') }).toThrow('not registered')
  })

  it('adopts a Host preference over the English default without writing it back', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    host.publish({ status: 'ready', value: { preference: 'zh' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('zh')
    expect(events).toHaveLength(1)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { preference: 'zh' }, revision: 2 })
    expect(events).toHaveLength(1)
  })

  it('an absent Host preference returns to the English default', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc } = make(host)
    host.publish({ status: 'ready', value: { preference: 'vi' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('vi')
    host.publish({ value: {}, revision: 2 })
    expect(svc.getLocale().active).toBe('en')
  })

  it('adopts a section already standing at construction and releases its subscription on dispose', async () => {
    const host = stubSettingsScope<LocaleSettings>()
    host.publish({ status: 'ready', value: { preference: 'zh' }, revision: 1, writable: true })
    const { ctx, svc } = make(host)
    expect(svc.getLocale().active).toBe('zh')
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('opens in the English default regardless of the browser language', () => {
    // Regional variants and unshipped languages alike: the product default
    // is en, and the navigator is never consulted.
    stubLanguages('en-GB', 'zh-CN')
    expect(make().svc.getLocale().active).toBe('en')
    stubLanguages('zh-Hans-CN')
    expect(make().svc.getLocale().active).toBe('en')
    stubLanguages('vi-VN')
    expect(make().svc.getLocale().active).toBe('en')
    stubLanguages('fr-FR', 'de')
    expect(make().svc.getLocale().active).toBe('en')
  })

  it('runs outside a browser (node boots): the same default, machine navigator never consulted', () => {
    vi.stubGlobal('window', undefined)
    // Node exposes its own global navigator; it must not decide the locale.
    stubLanguages('vi-VN')
    const { svc } = make()
    expect(svc.getLocale().active).toBe('en')
    svc.setLocale('zh')
    expect(svc.getLocale().active).toBe('zh')
  })

  it('lets an explicit in-process preference replace the default', () => {
    stubLanguages('zh-CN')
    const { svc } = make()
    svc.setLocale('vi')
    expect(svc.getLocale().active).toBe('vi')
  })

  it('exposes the three shipped locales with self-described labels in display order', () => {
    const { svc } = make()
    expect(svc.getLocale().locales).toEqual([
      { id: 'en', label: 'English' },
      { id: 'vi', label: 'Tiếng Việt' },
      { id: 'zh', label: '中文' },
    ])
  })
})
