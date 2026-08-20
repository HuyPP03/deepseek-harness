/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-registry`.
 * @module @deepseek-ai/dsh-mcp-registry/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-registry'

/** Cordis companion plugin name. */
export const name = 'mcp-registry-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry is a pull-based read face over reporter
 * closures; each mcp-client owns its own connection lifecycle and the tool
 * registry owns the tool registrations the reporter describes.
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
