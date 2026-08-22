/**
 * `@deepseek-ai/dsh-web-fetch-websift`: registers a websift-backed
 * `WebFetchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's fetch registry, like
 * `@deepseek-ai/dsh-web-fetch-http`. The websift library is the transport and
 * extraction owner (SSRF-safe retrieval, HTML-to-markdown, PDF-to-text); this
 * package owns the seam mapping and the fetch policy config.
 * @module @deepseek-ai/dsh-web-fetch-websift
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { WebsiftFetchProvider, type WebsiftFetchProviderOptions } from './provider.ts'

export { WEBSIFT_FETCH_PROVIDER_ID, WebsiftFetchProvider } from './provider.ts'
export type { WebsiftFetchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-websift'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_PAGE_CHARS = 128_000

/** Plugin config (all optional — the defaults are the shipped keyless policy). */
export interface Config {
  /** Allow `http://` (non-TLS) fetch targets. Defaults to false. */
  allowHttp?: boolean
  /** Provider-side fetch timeout in milliseconds. */
  timeoutMs?: number
  /** Maximum rendered page length in characters. */
  maxPageChars?: number
}

export const Config: z<Config> = z.object({
  allowHttp: z.boolean().default(false),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxPageChars: z.number().default(DEFAULT_MAX_PAGE_CHARS),
})

/** A timeout cap must be a positive finite number. */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`web-fetch-websift: ${name} must be a positive finite number`)
  }
}

/** A character cap must be a positive integer. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`web-fetch-websift: ${name} must be a positive integer`)
  }
}

/**
 * Register the websift fetch provider with `ctx.web`.
 * @param ctx - the Cordis context whose web seam receives the provider.
 * @param config - the plugin config; a section resolved through the `Config`
 *   schema always carries the defaults, and a raw entry (a direct `apply`
 *   without a schema pass) gets the same defaults here.
 */
export function apply(ctx: Context, config: Config): void {
  const options: WebsiftFetchProviderOptions = {
    allowHttp: config.allowHttp ?? false,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxPageChars: config.maxPageChars ?? DEFAULT_MAX_PAGE_CHARS,
  }
  assertPositiveFinite('timeoutMs', options.timeoutMs)
  assertPositiveInteger('maxPageChars', options.maxPageChars)
  ctx.web.registerFetchProvider(new WebsiftFetchProvider(options))
}
