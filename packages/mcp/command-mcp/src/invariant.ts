/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-mcp`.
 * @module @deepseek-ai/dsh-command-mcp/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-mcp'

/** Cordis companion plugin name. */
export const name = 'command-mcp-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the command renders a point-in-time mcp-registry
 * snapshot; the command runtime owns the invocation lifecycle and the
 * mcp-client owns the reported connection state.
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
