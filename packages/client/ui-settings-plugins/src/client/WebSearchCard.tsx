/**
 * The web-search provider's card: the keyless backend and, for the `searxng`
 * backend, its endpoint. No key control — the route is keyless, and the
 * shipped DeepSeek key stays managed on the Models page.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WebSearchCardFace } from './web-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the web-search card. */
export type WebSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebSearchCardFace>

/**
 * Render the web-search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebSearchCard(props: WebSearchCardProps) {
  const { t } = props
  const state = props.useWebSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="webSearchTitle"
      descriptionKey="webSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-web-search-provider"
        label={t('webSearchProvider')}
        hint={t('webSearchProviderHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('webSearchProviderInvalid')}
        disabled={disabled}
        {...state.provider}
        onEdit={(text) => { props.edit('provider', text) }}
        onReset={() => { props.resetField('provider') }}
      />
      <ValueField
        id="plugin-config-web-search-endpoint"
        label={t('webSearchBaseUrl')}
        hint={t('webSearchBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseUrl}
        onEdit={(text) => { props.edit('baseUrl', text) }}
        onReset={() => { props.resetField('baseUrl') }}
      />
    </PluginCard>
  )
}
