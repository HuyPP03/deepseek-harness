/**
 * Client-safe type surface of the OAuth token bundle store: the bundle
 * shape and the store's Cordis event declaration. Types only — no runtime
 * code, and nothing here reaches a Host-only symbol, so a Client
 * compilation face reads exactly the signature the Host emits.
 *
 * @module @deepseek-ai/dsh-credentials-oauth-tokens/types
 */

/**
 * One stored OAuth token bundle. `refreshToken` and `scope` are optional:
 * a provider may issue an access token without a refresh grant, and a
 * bundle without a recorded scope is still usable — the owner re-authenticates
 * rather than guessing. `createdAt`/`updatedAt` are the store's own write
 * times, not provider facts.
 */
export interface OAuthTokenBundle {
  /** The current access token presented to the provider. */
  readonly accessToken: string
  /** Epoch milliseconds after which the access token must be refreshed or re-authorized. */
  readonly expiresAt: number
  /** Provider token endpoint used for refresh. */
  readonly tokenEndpoint: string
  /** Refresh grant, absent when the provider issued no refresh token. */
  readonly refreshToken?: string
  /** Granted scope set, recorded when the provider returned one. */
  readonly scope?: string
  /** Pre-registered client id the bundle was issued under (bring-your-own-app flows). */
  readonly clientId?: string
  /** Epoch milliseconds of the first store write for this owner. */
  readonly createdAt: number
  /** Epoch milliseconds of the last store write for this owner. */
  readonly updatedAt: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to one owner's stored bundle: a `put`, a `remove`,
     * or an external edit observed in storage. Listener failures are
     * contained and logged — a sync throw and an async rejection alike —
     * without changing the committed operation's outcome, except
     * `INVARIANT`-coded failures, which rethrow after every listener ran;
     * that rethrow reaches the emitter only from synchronous listeners,
     * so invariant checks on this event must not be async functions.
     * @param ownerId - the owner whose stored bundle changed.
     * @mode emit
     */
    'oauth-tokens/updated'(ownerId: string): void
  }
}
