/**
 * The risk-note derivation: which possible failure modes a connector's
 * secret-free view exposes, and the three-line cap the cards keep.
 */
import { describe, expect, it } from 'vitest'
import type { ConnectorView } from '@deepseek-ai/dsh-api-remotes/client'
import { riskNotesOf } from '../src/client/risks.ts'

function view(withFields: Partial<ConnectorView> & { id: string }): ConnectorView {
  return {
    name: withFields.id,
    description: 'a description',
    presetId: withFields.id,
    state: 'connected',
    custom: false,
    servers: [],
    auth: [],
    suggestions: [],
    ...withFields,
  }
}

describe('riskNotesOf', () => {
  it('derives nothing from a plain mounted connector', () => {
    expect(riskNotesOf(view({ id: 'x' }))).toEqual([])
  })

  it('names the unconfigured token references and flags a stored token as revocable', () => {
    const unconfigured = riskNotesOf(view({
      id: 'x', auth: [{ mode: 'token', configured: false, credentialRefs: ['A', 'B'] }],
    }))
    expect(unconfigured).toEqual([{ key: 'risk.token', params: { refs: 'A, B' } }])
    const configured = riskNotesOf(view({
      id: 'x', auth: [{ mode: 'token', configured: true, credentialRefs: ['A'] }],
    }))
    expect(configured).toEqual([{ key: 'risk.tokenStale', params: { refs: 'A' } }])
  })

  it('flags the browser sign-in and the manual device code', () => {
    expect(riskNotesOf(view({ id: 'x', auth: [{ mode: 'oauth', configured: false }] })))
      .toEqual([{ key: 'risk.oauth' }])
    expect(riskNotesOf(view({ id: 'x', auth: [{ mode: 'device', configured: false }] })))
      .toEqual([{ key: 'risk.device' }])
  })

  it('counts the unmounted servers and marks a custom connector', () => {
    const mixed = riskNotesOf(view({
      id: 'x',
      servers: [
        { serverName: 'a', mounted: true },
        { serverName: 'b', mounted: false },
        { serverName: 'c', mounted: false },
      ],
    }))
    expect(mixed).toEqual([{ key: 'risk.servers', params: { count: 2 } }])
    expect(riskNotesOf(view({ id: 'x', custom: true })))
      .toEqual([{ key: 'risk.custom' }])
  })

  it('keeps three lines, most actionable first (auth, then servers, then custom)', () => {
    const notes = riskNotesOf(view({
      id: 'x',
      custom: true,
      auth: [
        { mode: 'token', configured: false, credentialRefs: ['A'] },
        { mode: 'oauth', configured: false },
        { mode: 'device', configured: false },
      ],
      servers: [{ serverName: 'a', mounted: false }],
    }))
    expect(notes).toEqual([
      { key: 'risk.token', params: { refs: 'A' } },
      { key: 'risk.oauth' },
      { key: 'risk.device' },
    ])
  })
})
