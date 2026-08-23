/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-connectors-device-flow`.
 * @module @deepseek-ai/dsh-connectors-device-flow/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-connectors-device-flow'

/** Cordis companion plugin name. */
export const name = 'connectors-device-flow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the flow's settled outcomes (authorizing flag,
 * recorded failure, unmounted servers) are all observable through the
 * connectors seam its suite pins, and the in-flight window is transient
 * process state with no committed event of its own.
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
