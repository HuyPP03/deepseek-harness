/**
 * Connectors browsing region: the secret-free roster as a list of rows, each
 * with its state dot, the server summary, and the row action its state
 * allows (configure a token, connect, or disconnect). The token dialog is the
 * only place a credential value enters the client. Rail state renders one
 * link icon that requests expansion; the shell renders this region only on
 * the connectors tab, so no tab state crosses the boundary.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconLinkOutline16, Input, Modal, StateDot, Tooltip, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectorState, ConnectorView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectorsRegionProps } from './contract/slots.ts'
import type { ConnectTokenDialog } from './controller.ts'
import type { ConnectorsKey } from './locales.ts'
import css from './ConnectorsRegion.module.css'

/** Each derived state's `state.*` copy key (the translate takes the union, not a template). */
const STATE_KEY: Record<ConnectorState, ConnectorsKey> = {
  'unconfigured': 'state.unconfigured',
  'needs-auth': 'state.needs-auth',
  'authorizing': 'state.authorizing',
  'connecting': 'state.connecting',
  'connected': 'state.connected',
  'reconnecting': 'state.reconnecting',
  'down': 'state.down',
  'error': 'state.error',
}

/** Map one derived connector state to the four-color state dot semantic. */
export function dotStateOf(state: ConnectorState): StateDotState {
  if (state === 'connected') return 'done'
  if (state === 'authorizing' || state === 'connecting' || state === 'reconnecting') return 'ongoing'
  if (state === 'down' || state === 'error') return 'error'
  return 'warning'
}

/** Whether the row offers the configure action (an unconfigured token method). */
export function canConfigure(row: ConnectorView): boolean {
  if (row.state !== 'unconfigured' && row.state !== 'needs-auth') return false
  const token = row.auth.find(entry => entry.mode === 'token')
  return token !== undefined && !token.configured
}

/** Whether the row offers the connect action (configured or a failed mount). */
export function canConnect(row: ConnectorView): boolean {
  return row.state === 'needs-auth' || row.state === 'down' || row.state === 'error'
}

/** Whether the row offers the disconnect action (a live or settling mount). */
export function canDisconnect(row: ConnectorView): boolean {
  return row.state === 'connecting' || row.state === 'connected' || row.state === 'reconnecting'
}

/**
 * One roster row: identity, state dot, description, the server summary, the
 * row-level error (operation failure or the host's recorded lastError), and
 * the action cluster the state allows.
 * @param props.row - the secret-free view.
 * @param props.busy - whether this row has an operation in flight.
 * @param props.error - the row's operation failure message, absent when none.
 * @param props.t - the connectors namespace translate.
 * @param props.onConfigure - open the token dialog.
 * @param props.onConnect - mount through the stored credentials.
 * @param props.onDisconnect - unmount and forget the credential.
 * @returns the row element.
 */
function ConnectorRow({ row, busy, error, t, onConfigure, onConnect, onDisconnect }: {
  row: ConnectorView
  busy: boolean
  error: string | null
  t: ConnectorsRegionProps['t']
  onConfigure: (id: string) => void
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
}): ReactNode {
  const mounted = row.servers.filter(server => server.mounted).length
  const off = row.servers.length - mounted
  const message = error ?? (row.state === 'error' ? row.lastError ?? null : null)
  // A tokenless unconfigured row still explains how to get the credential.
  const guidance = row.state === 'unconfigured' && !canConfigure(row)
    ? row.auth[0]?.howTo ?? null
    : null
  return (
    <div className={css.row}>
      <div className={css.rowMain}>
        <StateDot state={dotStateOf(row.state)} />
        <span className={css.rowName}>{row.name}</span>
        {row.custom && <span className={css.customBadge}>{t('custom')}</span>}
        <span className={css.stateLabel}>{t(STATE_KEY[row.state])}</span>
      </div>
      <span className={css.rowDescription}>{row.description}</span>
      {row.servers.length > 0 && (
        <span className={css.rowMeta}>
          {t(row.servers.length === 1 ? 'servers.one' : 'servers.many', { count: row.servers.length })}
          {off > 0 && ` · ${t('server.off')}`}
        </span>
      )}
      {guidance !== null && <span className={css.rowMeta}>{guidance}</span>}
      {message !== null && <span className={css.rowError}>{message}</span>}
      {(canConfigure(row) || canConnect(row) || canDisconnect(row)) && (
        <div className={css.rowActions}>
          {canConfigure(row) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => { onConfigure(row.id) }}
            >
              {t('configure')}
            </Button>
          )}
          {canConnect(row) && (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => { onConnect(row.id) }}
            >
              {t('connect')}
            </Button>
          )}
          {canDisconnect(row) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => { onDisconnect(row.id) }}
            >
              {t('disconnect')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Token dialog props: the draft plus the actions that mutate it. */
interface TokenDialogProps {
  dialog: ConnectTokenDialog
  t: ConnectorsRegionProps['t']
  onClose: () => void
  onDraft: (value: string) => void
  onSave: () => Promise<void>
}

/**
 * Render the token dialog: one secret field over a fixed connector, with the
 * token method's obtaining instructions as the description.
 * @param props - the draft, the copy, and the mutations.
 * @returns the modal.
 */
function TokenDialog({ dialog, t, onClose, onDraft, onSave }: TokenDialogProps): ReactNode {
  return (
    <Modal
      open
      onClose={onClose}
      title={t('dialog.title', { name: dialog.name })}
      closeLabel={t('dialog.cancel')}
      {...(dialog.howTo === null ? {} : { description: dialog.howTo })}
      className={css.dialog as string}
      footer={(
        <div className={css.dialogFooter}>
          <Button variant="outline" size="sm" disabled={dialog.saving} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            autoFocus
            disabled={dialog.saving || dialog.draft.trim() === ''}
            onClick={() => { void onSave() }}
          >
            {dialog.saving ? t('dialog.saving') : t('dialog.save')}
          </Button>
        </div>
      )}
    >
      <div className={css.dialogField}>
        <span className={css.dialogFieldLabel}>{t('dialog.token')}</span>
        <Input
          type="password"
          value={dialog.draft}
          placeholder={t('dialog.tokenPlaceholder')}
          onChange={(event) => { onDraft(event.target.value) }}
        />
        {dialog.error !== null && <span className={css.dialogError}>{dialog.error}</span>}
      </div>
    </Modal>
  )
}

/**
 * Render the connectors browsing region.
 * @param props - composed slot props (owner share + locale + inject face).
 * @returns the region element tree.
 */
export function ConnectorsRegion(props: ConnectorsRegionProps): ReactNode {
  const {
    wide, expandSidebar, t, load, openTokenDialog, setDialogDraft, closeDialog,
    saveToken, connect, disconnect, useConnectors,
  } = props
  const state = useConnectors(snapshot => snapshot)
  // The roster read is the region's own: it re-reads on every mount (a tab
  // switch remounts the region), so the view is as fresh as the host.
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
  } else if (state.connectors.length === 0) {
    body = <div className={css.message}>{t('empty')}</div>
  } else {
    body = (
      <div className={css.list}>
        {state.connectors.map(row => (
          <ConnectorRow
            key={row.id}
            row={row}
            // One operation at a time (the controller gates a second in
            // flight), so every row action rides the same busy flag.
            busy={state.busyId !== null}
            error={state.opError?.id === row.id ? state.opError.message : null}
            t={t}
            onConfigure={openTokenDialog}
            onConnect={(id) => { void connect(id) }}
            onDisconnect={(id) => { void disconnect(id) }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.sectionHeader}>{t('rail.label')}</div>
      {body}
      {state.dialog !== null && (
        <TokenDialog
          dialog={state.dialog}
          t={t}
          onClose={closeDialog}
          onDraft={setDialogDraft}
          onSave={saveToken}
        />
      )}
    </div>
  )
}
