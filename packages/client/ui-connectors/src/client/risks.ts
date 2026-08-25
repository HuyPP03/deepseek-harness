/**
 * Possible failure modes of one connector, derived from its secret-free wire
 * view: what a connect can still get wrong (a token that is invalid or gets
 * revoked, a browser grant that expires, a multi-server mount that fails in
 * part). Pure over the view — the card renders the localized lines, so no
 * copy crosses the boundary.
 */
import type { ConnectorView } from '@deepseek-ai/dsh-api-remotes/client'

/** One risk line: the locale key plus its interpolation params. */
export interface RiskNote {
  /** The `risk.*` locale key of the line. */
  readonly key: 'risk.token' | 'risk.tokenStale' | 'risk.oauth' | 'risk.device' | 'risk.servers' | 'risk.custom'
  /** Interpolation params for the key. */
  readonly params?: Readonly<Record<string, string | number>>
}

/** The most a card shows: three lines keep the grid scannable. */
const MAX_NOTES = 3

/**
 * Derive one connector's risk notes from its wire view.
 * @param view - the secret-free view.
 * @returns up to {@link MAX_NOTES} notes, most actionable first.
 */
export function riskNotesOf(view: ConnectorView): readonly RiskNote[] {
  const notes: RiskNote[] = []
  for (const method of view.auth) {
    if (method.mode === 'token') {
      const refs = (method.credentialRefs ?? []).join(', ')
      notes.push(method.configured
        ? { key: 'risk.tokenStale', params: { refs } }
        : { key: 'risk.token', params: { refs } })
    } else if (method.mode === 'oauth') {
      notes.push({ key: 'risk.oauth' })
    } else {
      notes.push({ key: 'risk.device' })
    }
  }
  const off = view.servers.filter(server => !server.mounted).length
  if (off > 0) {
    notes.push({ key: 'risk.servers', params: { count: off } })
  }
  if (view.custom) {
    notes.push({ key: 'risk.custom' })
  }
  return notes.slice(0, MAX_NOTES)
}
