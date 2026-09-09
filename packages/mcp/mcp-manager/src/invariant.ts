/**
 * Package-owned invariant companion for `@open-harness/oh-mcp-manager`.
 * @module @open-harness/oh-mcp-manager/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@open-harness/oh-invariants'

const PACKAGE_NAME = '@open-harness/oh-mcp-manager'

/** Cordis companion plugin name. */
export const name = 'mcp-manager-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the file↔mount relation the manager owns is enforced
 * at its only mutation points (`add` writes before mounting and deletes on
 * failure; `remove` disposes before deleting; startup loads before publish),
 * and the mcp-registry and mcp-client companions own the connection-side
 * relations.
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
