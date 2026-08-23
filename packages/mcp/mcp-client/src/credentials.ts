/**
 * Credential-reference resolution for MCP server values. A server env entry
 * or HTTP header may carry a `{$cred: REF}` reference instead of a literal;
 * every connection attempt re-resolves the references, so a stored or
 * refreshed value reaches the next attempt without a restart.
 *
 * Resolution order per reference: the `credentials` service (the stored raw
 * value), then the `oauthTokens` store (a stored bundle presented as a
 * `Bearer` header value for the reference as owner id). A reference stored in
 * neither fails the attempt.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials-oauth-tokens'
import type { Config } from './index.ts'

/** One `{$cred: REF}` reference carried by a server env or header value. */
export interface CredentialRefValue {
  /** The credential reference to resolve at connect time. */
  readonly $cred: string
}

/** A literal server value or a credential reference. */
export type ServerValue = string | CredentialRefValue

/** The stdio config with every env entry resolved to a literal. */
export type ResolvedStdioConfig = Omit<Extract<Config, { transport: 'stdio' }>, 'env'> & { env: Record<string, string> }

/** The streamable-http config with every header resolved to a literal. */
export type ResolvedStreamableHttpConfig = Omit<Extract<Config, { transport: 'streamable-http' }>, 'headers'> & { headers: Record<string, string> }

/** The plugin config with every credential reference resolved. */
export type ResolvedConfig = ResolvedStdioConfig | ResolvedStreamableHttpConfig

/**
 * The credentials service's reference pattern (a POSIX shell identifier),
 * mirrored so an oauth-style owner id such as a connector id can be checked
 * without a throw round trip.
 */
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Resolve one reference: the credentials store's raw value first, then the
 * oauth-tokens store's bundle for the reference as owner id presented as a
 * bearer header value.
 * @param ctx - the plugin context the optional services are read from.
 * @param ref - the reference to resolve.
 * @param serverName - the owning server, for the failure message.
 * @returns the literal value for the transport.
 * @throws when neither store has a value for the reference.
 */
async function resolveRef(ctx: Context, ref: string, serverName: string): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && CREDENTIAL_REF_PATTERN.test(ref)) {
    const resolved = await credentials.resolve(credentialRef(ref))
    if (resolved !== undefined) return resolved.value
  }
  const tokens = ctx.get('oauthTokens')
  const bundle = tokens !== undefined ? tokens.get(ref) : undefined
  if (bundle !== undefined) return `Bearer ${bundle.accessToken}`
  throw new Error(`mcp-client(${serverName}): no stored value for credential reference "${ref}" — store it through the owning surface and reconnect`)
}

/**
 * Resolve every credential reference in one plugin config to literals.
 * Literal values pass through unchanged; the result is structurally the same
 * config with plain `string` env and header values.
 * @param ctx - the plugin context the optional services are read from.
 * @param config - the plugin config, possibly carrying references.
 * @returns the config with every env and header value a literal.
 * @throws when a reference resolves in neither store.
 */
export async function resolveServerValues(ctx: Context, config: Config): Promise<ResolvedConfig> {
  if (config.transport === 'stdio') {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(config.env)) {
      env[key] = typeof value === 'string' ? value : await resolveRef(ctx, value.$cred, config.serverName)
    }
    return { ...config, env }
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(config.headers)) {
    headers[name] = typeof value === 'string' ? value : await resolveRef(ctx, value.$cred, config.serverName)
  }
  return { ...config, headers }
}
