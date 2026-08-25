/**
 * The sidebar's connected-providers list: a compact row per already-connected
 * provider (state dot + name). Clicking a row selects the provider, so the
 * directory in the main area (the frame's main.connectors overlay) shows its
 * detail; the rail renders one link icon that requests expansion. Only
 * connected providers appear here — the browse cards live in the directory.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconLinkOutline16, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectedProvidersListProps } from './contract/slots.ts'
import css from './ConnectedProvidersList.module.css'

/**
 * Render the connected-providers list.
 * @param props - the composed slot props (owner share + locale + inject face).
 * @returns the list element tree.
 */
export function ConnectedProvidersList(props: ConnectedProvidersListProps): ReactNode {
  const { wide, expandSidebar, t, load, selectProvider, useConnectors } = props
  const state = useConnectors(snapshot => snapshot)
  // The roster read is the list's own: it re-reads on every mount (a tab
  // switch remounts it); the controller single-flights a second read.
  useEffect(() => {
    void load()
  }, [load])

  if (!wide) {
    return (
      <div className={clsx(css.root, css.rail)}>
        <Tooltip label={t('rail.label')} delayMs={500}>
          <button
            type="button"
            className={css.railIcon}
            aria-label={t('rail.label')}
            onClick={() => { expandSidebar() }}
          >
            <IconLinkOutline16 size={18} />
          </button>
        </Tooltip>
      </div>
    )
  }

  const connected = state.connectors.filter(row => row.state === 'connected')

  let body: ReactNode
  if (state.status === 'loading') {
    body = <div className={css.message}>{t('loading')}</div>
  } else if (state.status === 'error') {
    body = (
      <div className={clsx(css.message, css.error)}>
        <span>{state.error}</span>
        <Button variant="outline" size="sm" onClick={() => { void load() }}>
          {t('retry')}
        </Button>
      </div>
    )
  } else if (connected.length === 0) {
    body = <div className={css.message}>{t('list.empty')}</div>
  } else {
    body = (
      <div className={css.list}>
        {connected.map(row => (
          <div
            key={row.id}
            className={css.row}
            role="button"
            tabIndex={0}
            onClick={() => { selectProvider(row.id) }}
            onKeyDown={(e) => { if (e.key === 'Enter') selectProvider(row.id) }}
          >
            <StateDot state="done" />
            <span className={css.rowName}>{row.name}</span>
            {row.custom && <span className={css.customBadge}>{t('custom')}</span>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.sectionHeader}>{t('list.title')}</div>
      {body}
    </div>
  )
}
