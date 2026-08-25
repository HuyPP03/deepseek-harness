/**
 * Client-safe type surface of the connector OAuth flow engine: the flow
 * start result that crosses the wire and the engine's Cordis context
 * declaration. Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-connectors-oauth-flow/types
 */

/** The started browser flow the client opens; the loopback exchange completes server-side. */
export interface OAuthFlowStart {
  /** The authorization URL to open in a browser tab. */
  readonly authorizationUrl: string
  /** Epoch milliseconds after which the flow expires and the loopback stops listening. */
  readonly expiresAt: number
}
