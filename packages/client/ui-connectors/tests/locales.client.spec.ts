/**
 * The connectors dictionaries: en is the key-set source of truth, and the
 * shipped languages stay complete against it with non-empty values.
 */
import { describe, expect, it } from 'vitest'
import { en, vi, zh, type ConnectorsKey } from '../src/client/locales.ts'

describe('connectors dictionaries', () => {
  it('keeps the shipped languages complete against the en key set', () => {
    for (const bundle of [vi, zh]) {
      expect(Object.keys(bundle).sort()).toEqual(Object.keys(en).sort())
      for (const key of Object.keys(bundle) as ConnectorsKey[]) {
        expect(bundle[key].length).toBeGreaterThan(0)
      }
    }
  })

  it('interpolates the server count and the dialog title', () => {
    const translate = (bundle: typeof en) =>
      (key: ConnectorsKey, params?: Record<string, unknown>): string =>
        (bundle[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
          name in (params ?? {}) ? String(params?.[name]) : match)

    expect(translate(en)('servers.one', { count: 1 })).toBe('1 server')
    expect(translate(en)('servers.many', { count: 3 })).toBe('3 servers')
    expect(translate(en)('dialog.title', { name: 'Notion' })).toBe('Connect Notion')
    expect(translate(zh)('servers.many', { count: 2 })).toBe('2 个服务器')
    expect(translate(vi)('dialog.title', { name: 'Notion' })).toBe('Kết nối Notion')
  })
})
