/**
 * The web-search card's staged form over the `web-search-websift` settings
 * namespace.
 *
 * Both fields live in the section: the keyless backend and, for the `searxng`
 * backend, its endpoint. The card edits only what the section carries; the
 * shipped DeepSeek key is managed on the Models page, never here.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, choiceField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the websift search provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_SEARCH_NS = 'web-search-websift'

/** The keyless backends the provider accepts. */
export const WEB_SEARCH_PROVIDERS = ['ddgs', 'searxng'] as const

/** The search-provider fields this card edits. */
export interface WebSearchSettings {
  /** Keyless backend: `ddgs` or `searxng`. */
  provider?: string
  /** SearXNG endpoint base; used when `provider` is `searxng`. */
  baseUrl?: string
}

/** What the web-search card renders. */
export interface WebSearchCardState extends CardShell {
  /** Keyless backend. */
  provider: CardFieldState
  /** SearXNG endpoint base. */
  baseUrl: CardFieldState
}

/** The registration-side face the web-search card's slot entry injects. */
export interface WebSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
}

/** Bridges the `web-search-websift` scope onto the card. */
export class WebSearchCardController {
  private readonly form: CardForm<WebSearchSettings>
  private readonly store: SnapshotStore<WebSearchCardState>

  /**
   * @param scope - the bound settings scope for the `web-search-websift` namespace.
   */
  constructor(scope: SettingsScope<WebSearchSettings>) {
    this.form = new CardForm(
      scope,
      [choiceField('provider', WEB_SEARCH_PROVIDERS), textField('baseUrl')],
    )
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WebSearchCardState {
    return {
      ...this.form.shell(),
      provider: this.form.field('provider'),
      baseUrl: this.form.field('baseUrl'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WebSearchCardFace {
    return { hooks: { webSearchCard: this.store }, ...this.form.actions() }
  }
}
