/**
 * The roster row's state-to-action rules, shared by the sidebar list and the
 * directory card: which state dot color a state takes, and which row action
 * each state allows (configure a token, connect, or disconnect).
 */
import type { ConnectorState, ConnectorView } from '@deepseek-ai/dsh-api-remotes/client'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectorsKey } from './locales.ts'

/** Each derived state's `state.*` copy key (the translate takes the union, not a template). */
export const STATE_KEY: Record<ConnectorState, ConnectorsKey> = {
  'unconfigured': 'state.unconfigured',
  'needs-auth': 'state.needs-auth',
  'authorizing': 'state.authorizing',
  'connecting': 'state.connecting',
  'connected': 'state.connected',
  'reconnecting': 'state.reconnecting',
  'down': 'state.down',
  'error': 'state.error',
}

/**
 * Map one derived connector state to the four-color state dot semantic.
 * @param state - the derived connector state.
 * @returns the dot semantic: `done` for connected, `ongoing` for a settling state, `error` for a failed mount, `warning` otherwise.
 */
export function dotStateOf(state: ConnectorState): StateDotState {
  if (state === 'connected') return 'done'
  if (state === 'authorizing' || state === 'connecting' || state === 'reconnecting') return 'ongoing'
  if (state === 'down' || state === 'error') return 'error'
  return 'warning'
}

/**
 * Whether the row offers the configure action (an unconfigured token method).
 * @param row - the roster row view.
 * @returns true for an unconfigured or needs-auth connector whose token method is not yet stored.
 */
export function canConfigure(row: ConnectorView): boolean {
  if (row.state !== 'unconfigured' && row.state !== 'needs-auth') return false
  const token = row.auth.find(entry => entry.mode === 'token')
  return token !== undefined && !token.configured
}

/**
 * Whether the row offers the connect action (a ready credential, a failed mount, or an unconfigured browser/device flow).
 * @param row - the roster row view.
 * @returns true when starting a connect (or its flow) is the correct action for this state.
 */
export function canConnect(row: ConnectorView): boolean {
  if (row.state === 'needs-auth' || row.state === 'down' || row.state === 'error') return true
  // An unconfigured connector whose credential is a browser sign-in or a
  // device code starts the flow directly; the token method offers Configure
  // instead, and a byoApp method offers Set up app instead (its flow cannot
  // start before the client id is stored), so both are excluded here.
  return row.state === 'unconfigured' && row.auth.some(entry =>
    (entry.mode === 'oauth' && entry.byoApp !== true) || entry.mode === 'device')
}

/**
 * Whether the row offers the set-up-app action: an unconfigured byoApp method, where the user
 * must store their pre-registered client id before any flow can start.
 * @param row - the roster row view.
 * @returns true for an unconfigured or needs-auth connector whose byoApp OAuth method is not yet configured.
 */
export function canConfigureApp(row: ConnectorView): boolean {
  if (row.state !== 'unconfigured' && row.state !== 'needs-auth') return false
  const oauth = row.auth.find(entry => entry.mode === 'oauth')
  return oauth?.byoApp === true && !oauth.configured
}

/** What a card click does: a live or settling card opens its detail, and the rest open the flow the connector's credential method needs. */
export type CardClickIntent =
  | { kind: 'select' }
  | { kind: 'configure' }
  | { kind: 'configure-app' }
  | { kind: 'authorize' }
  | { kind: 'device' }
  | { kind: 'connect' }

/**
 * Decide what a card click does for one row: a live or settling card opens its
 * detail, and the rest open the flow the connector's credential method needs.
 * @param row - the roster row view.
 * @returns the click intent: select the provider, or start configure / set-up-app / authorize / device / connect.
 */
export function cardClickIntent(row: ConnectorView): CardClickIntent {
  // A live or settling mount has nothing to start: the detail view shows it.
  if (row.state === 'connected' || row.state === 'authorizing' || row.state === 'connecting' || row.state === 'reconnecting') {
    return { kind: 'select' }
  }
  if (canConfigure(row)) return { kind: 'configure' }
  if (canConfigureApp(row)) return { kind: 'configure-app' }
  if (row.auth.some(entry => entry.mode === 'oauth')) return { kind: 'authorize' }
  if (row.auth.some(entry => entry.mode === 'device')) return { kind: 'device' }
  return { kind: 'connect' }
}

/**
 * Whether the row offers the disconnect action (a live or settling mount).
 * @param row - the roster row view.
 * @returns true while the mount is connected or settling.
 */
export function canDisconnect(row: ConnectorView): boolean {
  return row.state === 'connecting' || row.state === 'connected' || row.state === 'reconnecting'
}
