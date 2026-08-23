/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-connectors`.
 * @module @deepseek-ai/dsh-connectors/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-connectors'

/** Cordis companion plugin name. */
export const name = 'connectors-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service derives state on every read from the
 * authoritative seams (credentials, oauth-tokens, mcp-registry) rather than
 * owning mutable state they must mirror, and its `connector/state` fan-out is
 * the reviewed contained-dispatch contract. The unit and real-composition
 * suites pin the transition behavior.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
