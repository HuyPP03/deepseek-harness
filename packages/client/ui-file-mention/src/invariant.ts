/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-file-mention`.
 * @module @deepseek-ai/dsh-client-ui-file-mention/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-file-mention'

/** Cordis companion plugin name. */
export const name = 'client-ui-file-mention-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the '@' file source is a registry-owned registration
 * whose disposal is proven by the HMR-safety spec. It emits no cordis events
 * and owns no cross-plugin mutable state (the session-keyed fetch cache is
 * plugin-closure state torn down with the fiber).
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
