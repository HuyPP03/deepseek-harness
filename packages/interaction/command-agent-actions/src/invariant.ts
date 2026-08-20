/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-agent-actions`.
 * @module @deepseek-ai/dsh-command-agent-actions/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-agent-actions'

/** Cordis companion plugin name. */
export const name = 'command-agent-actions-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this command adapter owns no state or event stream; the
 * command registry owns registration and dispatch lifecycle, the agent loop
 * owns the steering inbox, and the subagent service owns the review children's
 * runs and settlement.
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
