/**
 * Package-owned invariant companion for `@open-harness/oh-connectors`.
 * @module @open-harness/oh-connectors/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@open-harness/cordis'
import type { InvariantInstaller } from '@open-harness/oh-invariants'

const PACKAGE_NAME = '@open-harness/oh-connectors'

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
