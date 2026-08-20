/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-slash-tools`.
 * @module @deepseek-ai/dsh-client-ui-slash-tools/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-slash-tools'

/** Cordis companion plugin name. */
export const name = 'client-ui-slash-tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: client command registrations (one action, one
 * popupSelect contribution, one host-command decoration) whose disposal is
 * proven by the HMR-safety specs — they emit no cordis events and own no
 * cross-plugin mutable state.
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
