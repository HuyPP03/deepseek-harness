/**
 * The MCP dictionaries: both languages carry the same key set, and the
 * templated strings take exactly the parameters the surfaces pass.
 */

import { describe, expect, it } from 'vitest'
import { en, zh, type McpKey } from '../src/client/locales.ts'

const keys = Object.keys(en) as McpKey[]

describe('MCP locale dictionaries', () => {
  it('ships the same keys in both languages', () => {
    expect(Object.keys(zh).sort()).toEqual([...keys].sort())
  })

  it('has no empty copy', () => {
    for (const key of keys) {
      expect(en[key].trim().length).toBeGreaterThan(0)
      expect(zh[key].trim().length).toBeGreaterThan(0)
    }
  })

  it('templates take exactly the parameters the surfaces pass', () => {
    expect(zh.reconnectTitle).toContain('{name}')
    expect(en.reconnectTitle).toContain('{name}')
    expect(zh.removeTitle).toContain('{name}')
    expect(en.removeTitle).toContain('{name}')
    expect(zh.toolsMany).toContain('{count}')
    expect(en.toolsMany).toContain('{count}')
  })
})
