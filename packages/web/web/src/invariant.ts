/**
 * Package-owned invariant companion for `@open-harness/oh-web`.
 * @module @open-harness/oh-web/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@open-harness/oh-invariants'

const PACKAGE_NAME = '@open-harness/oh-web'

/** Cordis companion plugin name. */
export const name = 'web-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: provider maps are private and selection/result caps are enforced on each
 * call; the seam publishes no independent registry or request/result observation stream.
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
