/**
 * Package-owned invariant companion for `@open-harness/oh-repeat-tool-reminder`.
 * @module @open-harness/oh-repeat-tool-reminder/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@open-harness/cordis'
import type { InvariantInstaller } from '@open-harness/oh-invariants'

const PACKAGE_NAME = '@open-harness/oh-repeat-tool-reminder'

/** Cordis companion plugin name. */
export const name = 'repeat-tool-reminder-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the repeat chain is private to one post-execute listener and exposes no
 * package-owned event or snapshot that an independent companion can observe.
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
