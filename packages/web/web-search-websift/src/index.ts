/**
 * `@deepseek-ai/dsh-web-search-websift`: registers a websift-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry,
 * like `@deepseek-ai/dsh-llm-deepseek` registers an adapter into `ctx.llm`.
 * The websift library is the transport owner; this package owns the seam
 * mapping, the keyless provider allowlist, and the settings section.
 * @module @deepseek-ai/dsh-web-search-websift
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import {
  WEBSIFT_PROVIDER_NAMES,
  WebsiftSearchProvider,
  type WebsiftProviderName,
  type WebsiftSearchProviderOptions,
} from './provider.ts'

export { WEBSIFT_PROVIDER_ID, WEBSIFT_PROVIDER_NAMES, WebsiftSearchProvider } from './provider.ts'
export type { WebsiftProviderName, WebsiftSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-websift'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_PROVIDER: WebsiftProviderName = 'ddgs'

/** Plugin config (all optional — defaults fill the keyless DuckDuckGo route). */
export interface Config {
  /** Keyless websift backend. Defaults to `ddgs`; `searxng` requires `baseUrl`. */
  provider?: string
  /** SearXNG endpoint base (required when `provider` is `searxng`). */
  baseUrl?: string
  /** Allow `http://` provider endpoints for local/self-hosted SearXNG. Defaults to false. */
  allowHttp?: boolean
}

export const Config: z<Config> = z.object({
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  provider: z.string().default(DEFAULT_PROVIDER),
  baseUrl: z.string(),
  allowHttp: z.boolean().default(false),
})

/** Settings namespace carrying this provider's backend selection. */
export const WEBSIFT_SETTINGS_NAMESPACE = settingsNamespace('web-search-websift')

/**
 * Fail loud at load on a misconfigured section: an unknown backend or a
 * SearXNG selection without an endpoint would only surface as a search-time
 * provider error otherwise. An omitted backend is not a misconfiguration —
 * it takes the same default the schema carries.
 * @param config - the section under test.
 */
function assertValidConfig(config: Config): void {
  const provider = config.provider ?? DEFAULT_PROVIDER
  if (!WEBSIFT_PROVIDER_NAMES.includes(provider as WebsiftProviderName)) {
    throw new Error(
      `web-search-websift: unknown search provider "${provider}" `
      + `(allowed: ${WEBSIFT_PROVIDER_NAMES.join(', ')})`,
    )
  }
  if (provider === 'searxng' && (config.baseUrl === undefined || config.baseUrl.length === 0)) {
    throw new Error('web-search-websift: provider "searxng" requires a baseUrl')
  }
}

/**
 * Project one section into the options the provider serves its next search
 * with. A section resolved through the `Config` schema always carries the
 * defaults; a raw entry (a direct `apply` without a schema pass) gets the
 * same defaults here, so both entry paths stay behaviorally identical.
 * `baseUrl` is carried only for the backend that takes an endpoint, so the
 * options stay exact per provider.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(config: Config): WebsiftSearchProviderOptions {
  const provider = (config.provider ?? DEFAULT_PROVIDER) as WebsiftProviderName
  return {
    provider,
    ...config.baseUrl !== undefined && config.baseUrl.length > 0 ? { baseUrl: config.baseUrl } : {},
    allowHttp: config.allowHttp ?? false,
  }
}

/** Register the websift search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  assertValidConfig(config)
  let current: () => Config = () => config
  installSettingsSection(ctx, WEBSIFT_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new WebsiftSearchProvider(() => resolveOptions(current())))
}
