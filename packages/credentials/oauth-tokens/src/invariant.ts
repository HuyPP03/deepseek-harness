/**
 * Package-owned invariant companion for `@open-harness/oh-credentials-oauth-tokens`.
 * @module @open-harness/oh-credentials-oauth-tokens/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@open-harness/oh-invariants'

const PACKAGE_NAME = '@open-harness/oh-credentials-oauth-tokens'

/** Cordis companion plugin name. */
export const name = 'credentials-oauth-tokens-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the store's durable contract (owner-only file mode,
 * strict document parsing, wholesale snapshot replacement) is asynchronous
 * I/O pinned by its unit suite, and the event fan-out is the reviewed
 * contained-dispatch contract.
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
