/**
 * The connectors directory: the full-column browse view over the
 * secret-free roster. The grid shows one card per connectable provider with
 * its description, the possible failure modes (the risk notes), the server
 * summary, and the row action its state allows (configure a token, connect,
 * or disconnect); selecting a card opens its detail — a connected provider
 * lists its own chats (the sessions born under its preset) with a New chat
 * starter. The token and custom dialogs are the only place a credential
 * value enters the client.
 */
import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectorView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { canConfigure, canConfigureApp, canConnect, canDisconnect, cardClickIntent, dotStateOf, STATE_KEY } from './rows.ts'
import { riskNotesOf } from './risks.ts'
import { CustomDialog, OauthAppDialog, TokenDialog } from './dialogs.tsx'
import type { ConnectorsDirectoryProps } from './contract/slots.ts'
import css from './ConnectorsDirectory.module.css'

/** The stable empty list the provider-session memo returns when no provider is selected. */
const EMPTY_SESSIONS: readonly SessionSummary[] = []

/**
 * One directory card: identity, state dot, description, the risk notes,
 * the server summary, the card-level error, and the action cluster the
 * state allows.
 * @param props.row - the secret-free view.
 * @param props.busy - whether this card has an operation in flight.
 * @param props.error - the card's operation failure message, absent when none.
 * @param props.t - the connectors namespace translate.
 * @param props.onConfigure - open the token dialog.
 * @param props.onConnect - mount through the stored credentials.
 * @param props.onAuthorize - open the browser OAuth flow.
 * @param props.onDeviceLogin - open the device-code flow.
 * @param props.onDisconnect - unmount and forget the credential.
 * @param props.onRemove - remove a custom connector.
 * @returns the card element.
 */
function ConnectorCard({ row, busy, error, t, onConfigure, onConfigureApp, onConnect, onAuthorize,
  onDeviceLogin, onDisconnect, onRemove }: {
  row: ConnectorView
  busy: boolean
  error: string | null
  t: ConnectorsDirectoryProps['t']
  onConfigure: (id: string) => void
  onConfigureApp: (id: string) => void
  onConnect: (id: string, mode: 'token' | 'oauth' | 'device') => void
  onAuthorize: (id: string) => void
  onDeviceLogin: (id: string) => void
  onDisconnect: (id: string) => void
  onRemove: (id: string) => void
}): ReactNode {
  const mounted = row.servers.filter(server => server.mounted).length
  const off = row.servers.length - mounted
  const risks = riskNotesOf(row)
  const message = error ?? (row.state === 'error' ? row.lastError ?? null : null)
  // A tokenless unconfigured card still explains how to get the credential.
  const guidance = row.state === 'unconfigured' && !canConfigure(row)
    ? row.auth[0]?.howTo ?? null
    : null
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <StateDot state={dotStateOf(row.state)} />
        <span className={css.cardName}>{row.name}</span>
        {row.custom && <span className={css.customBadge}>{t('custom')}</span>}
        <span className={css.cardState}>{t(STATE_KEY[row.state])}</span>
      </div>
      <span className={css.cardDescription}>{row.description}</span>
      {risks.length > 0 && (
        <div className={css.riskList}>
          {risks.map(note => (
            <span key={note.key} className={css.risk}>
              {t(note.key, note.params)}
            </span>
          ))}
        </div>
      )}
      {row.servers.length > 0 && (
        <span className={css.cardMeta}>
          {t(row.servers.length === 1 ? 'servers.one' : 'servers.many', { count: row.servers.length })}
          {off > 0 && ` · ${t('server.off')}`}
        </span>
      )}
      {guidance !== null && <span className={css.cardMeta}>{guidance}</span>}
      {message !== null && <span className={css.cardError}>{message}</span>}
      {(canConfigure(row) || canConfigureApp(row) || canConnect(row) || canDisconnect(row) || row.custom) && (
        <div className={css.cardActions}>
          {/* Every action stops the click: the card wrapper owns the card
              click, and a bubbling action click would re-run the same flow. */}
          {canConfigure(row) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onConfigure(row.id) }}
            >
              {t('configure')}
            </Button>
          )}
          {canConfigureApp(row) && (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onConfigureApp(row.id) }}
            >
              {t('card.setupApp')}
            </Button>
          )}
          {canConnect(row) && (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                const oauthMethod = row.auth.find(a => a.mode === 'oauth')
                const deviceMethod = row.auth.find(a => a.mode === 'device')
                if (oauthMethod !== undefined) {
                  onAuthorize(row.id)
                } else if (deviceMethod !== undefined) {
                  onDeviceLogin(row.id)
                } else {
                  onConnect(row.id, 'token')
                }
              }}
            >
              {t('connect')}
            </Button>
          )}
          {canDisconnect(row) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onDisconnect(row.id) }}
            >
              {t('disconnect')}
            </Button>
          )}
          {row.custom && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onRemove(row.id) }}
            >
              {t('remove')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Render the connectors directory (grid or the selected provider's detail).
 * @param props - the composed slot props (locale + inject face).
 * @returns the directory element tree.
 */
export function ConnectorsDirectory(props: ConnectorsDirectoryProps): ReactNode {
  const {
    t, load, openTokenDialog, setDialogDraft, closeDialog,
    saveToken, openOauthDialog, setOauthDraft, closeOauthDialog, saveOauth,
    connect, authorize, deviceLogin, disconnect, selectProvider, useConnectors,
    openCustomDialog, setCustomDraft, closeCustomDialog, saveCustom, removeCustom,
    useSessions, openSession, newProviderChat,
  } = props

  const handleAuthorize = (id: string): void => {
    void authorize(id).then(({ authorizationUrl }) => {
      window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
    }).catch(() => { /* error surfaces via the controller's opError */ })
  }

  const handleDeviceLogin = (id: string): void => {
    void deviceLogin(id).then((result) => {
      if (result.status === 'device-code' && result.verificationUri !== undefined) {
        window.open(result.verificationUri, '_blank', 'noopener,noreferrer')
      }
    }).catch(() => { /* error surfaces via the controller's opError */ })
  }
  const state = useConnectors(snapshot => snapshot)
  // The session list is the whole snapshot (a stable reference between
  // changes); the provider's chats are derived below with useMemo rather
  // than a per-render array inside a conditional selector — the hook must
  // run on every render regardless of the selected provider.
  const sessionList = useSessions(snapshot => snapshot)
  const providerSessions: readonly SessionSummary[] = useMemo(() => {
    if (state.selectedProvider === null) return EMPTY_SESSIONS
    const provider = state.connectors.find(c => c.id === state.selectedProvider)
    if (provider === undefined) return EMPTY_SESSIONS
    return sessionList.ids
      .map(id => sessionList.byId[id])
      .filter((entry): entry is SessionSummary =>
        entry !== undefined && !entry.blank && entry.agentPreset === provider.presetId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [state.selectedProvider, state.connectors, sessionList])
  // The roster read is the directory's own: it re-reads on every mount (the
  // overlay unmounts off the connectors tab); the controller single-flights
  // a second read from the sidebar list.
  useEffect(() => {
    void load()
  }, [load])

  // The card click: a connected card opens its detail; an unconnected card
  // opens the flow its credential method needs — the token dialog, the
  // browser OAuth flow, the device-code flow, or the plain connect.
  const handleCardClick = (row: ConnectorView): void => {
    switch (cardClickIntent(row).kind) {
      case 'select':
        selectProvider(row.id)
        break
      case 'configure':
        openTokenDialog(row.id)
        break
      case 'configure-app':
        openOauthDialog(row.id)
        break
      case 'authorize':
        handleAuthorize(row.id)
        break
      case 'device':
        handleDeviceLogin(row.id)
        break
      case 'connect':
        void connect(row.id, 'token')
        break
    }
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
  } else if (state.selectedProvider !== null) {
    // The selected provider's detail: a connected provider lists its own
    // chats (the sessions born under its preset) with a New chat starter;
    // the others still show the placeholder until a session exists.
    const provider = state.connectors.find(c => c.id === state.selectedProvider)
    if (provider === undefined) {
      body = <div className={css.message}>{t('empty')}</div>
    } else {
      body = (
        <div className={css.detail}>
          <div className={css.detailHeader}>
            <Button variant="outline" size="sm" onClick={() => { selectProvider(null) }}>
              {t('back')}
            </Button>
            <StateDot state={dotStateOf(provider.state)} />
            <span className={css.detailName}>{provider.name}</span>
            {provider.state === 'connected' && (
              <Button variant="outline" size="sm" className={css.newChatButton}
                onClick={() => { void newProviderChat(provider.id) }}>
                {t('sessions.new')}
              </Button>
            )}
          </div>
          {provider.state !== 'connected' && (
            <div className={css.message}>{t('sessions.placeholder')}</div>
          )}
          {provider.state === 'connected' && (providerSessions.length === 0
            ? <div className={css.message}>{t('sessions.empty')}</div>
            : (
              <div className={css.sessionList}>
                {providerSessions.map(entry => (
                  <div
                    key={entry.id}
                    className={css.sessionRow}
                    role="button"
                    tabIndex={0}
                    onClick={() => { openSession(entry.id) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') openSession(entry.id) }}
                  >
                    <span className={css.sessionTitle}>{entry.displayTitle}</span>
                    <StateDot state={entry.running ? 'ongoing' : 'done'} />
                  </div>
                ))}
              </div>
            ))}
          {state.providerTools.length > 0 && (
            <div className={css.toolsSection}>
              <span className={css.toolsLabel}>{t('tools.available')}</span>
              {state.providerTools.map(name => (
                <div key={name} className={css.toolRow}>{name}</div>
              ))}
            </div>
          )}
        </div>
      )
    }
  } else {
    // Provider grid: each card is a provider the user can select.
    body = (
      <div className={css.grid}>
        <div className={css.cards}>
          {state.connectors.map(row => (
            <div
              key={row.id}
              className={css.cardWrapper}
              role="button"
              tabIndex={0}
              onClick={() => { handleCardClick(row) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(row) }}
            >
              <ConnectorCard
                row={row}
                // One operation at a time (the controller gates a second in
                // flight), so every card action rides the same busy flag.
                busy={state.busyId !== null}
                error={state.opError?.id === row.id ? state.opError.message : null}
                t={t}
                onConfigure={openTokenDialog}
                onConfigureApp={openOauthDialog}
                onConnect={(id, mode) => { void connect(id, mode) }}
                onAuthorize={handleAuthorize}
                onDeviceLogin={handleDeviceLogin}
                onDisconnect={(id) => { void disconnect(id) }}
                onRemove={(id) => { void removeCustom(id) }}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={css.title}>{t('directory.title')}</span>
        <Button variant="outline" size="sm" onClick={() => { openCustomDialog() }}>
          {t('custom.new.button')}
        </Button>
      </div>
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
      {state.oauthDialog !== null && (
        <OauthAppDialog
          dialog={state.oauthDialog}
          t={t}
          onClose={closeOauthDialog}
          onDraft={setOauthDraft}
          onSave={saveOauth}
        />
      )}
      {state.customDialog !== null && (
        <CustomDialog
          dialog={state.customDialog}
          t={t}
          onClose={closeCustomDialog}
          onDraft={setCustomDraft}
          onSave={saveCustom}
        />
      )}
    </div>
  )
}
