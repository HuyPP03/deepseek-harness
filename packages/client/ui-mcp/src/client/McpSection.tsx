/**
 * MCP settings section: the live server roster with per-row reconnect and
 * (for user-managed rows) remove, plus the add-server form.
 *
 * The roster is a pull of the host's mcp.list — the page re-reads it after
 * every mutation, and a server that cannot connect yet still appears in its
 * own lifecycle state. Profile-declared rows reconnect but do not remove:
 * the deployment owns them, so they get no remove action at all.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconPlusOutline16, Modal, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerStatus } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { draftBlocker, type AddDraft, type McpSectionState } from './section-store.ts'
import type { McpKey } from './locales.ts'
import css from './McpSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP section copy. */
    'settings.mcp': McpKey
  }
}

/** Row type alias for the props below. */
type RowData = McpSectionState['rows'][number]

/** The translate seat's signature over the MCP namespace. */
type Translate = (key: McpKey, params?: Record<string, unknown>) => string

/** Registration-side business face of the MCP section. */
export interface McpSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useMcpSection. */
    mcpSection: SnapshotStore<McpSectionState>
  }
  /** Read the roster; called once when the section first renders. */
  load: () => Promise<void>
  /** Open the add form. */
  beginAdd: () => void
  /** Close the add form, discarding the draft. */
  cancelAdd: () => void
  /** Edit one add-form field. */
  setAddField: <K extends keyof Omit<AddDraft, 'saving' | 'error'>>(field: K, value: AddDraft[K]) => void
  /** Submit the add form. */
  submitAdd: () => Promise<void>
  /** Open the remove gate over one server, or dismiss it with null. */
  beginRemove: (name: string | null) => void
  /** Toggle the remove gate's acknowledgement. */
  setRemoveAcknowledged: (acknowledged: boolean) => void
  /** Remove the server awaiting confirmation. */
  remove: () => Promise<void>
  /** Ask one server to reconnect. */
  reconnect: (name: string) => Promise<void>
}

/** Full component props. */
export type McpSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpSectionInjected>

/** The status badge class per lifecycle state. */
const STATUS_CLASS: Record<McpServerStatus, string> = {
  /* v8 ignore start -- the css module exports every declared class; the
     fallback exists so an undecorated build renders an unstyled badge */
  connecting: css.statusConnecting ?? '',
  connected: css.statusConnected ?? '',
  reconnecting: css.statusReconnecting ?? '',
  down: css.statusDown ?? '',
  /* v8 ignore end */
}

/** The status word for one row, in the active locale. */
function statusText(status: McpServerStatus, t: Translate): string {
  if (status === 'connecting') return t('statusConnecting')
  if (status === 'connected') return t('statusConnected')
  if (status === 'reconnecting') return t('statusReconnecting')
  return t('statusDown')
}

/** The tool count line for one row, or the no-tools fallback. */
function toolsText(row: RowData, t: Translate): string {
  if (row.tools.length === 0) return t('noTools')
  if (row.tools.length === 1) return t('toolsOne')
  return t('toolsMany', { count: row.tools.length })
}

/** One roster row: name, status, tools, and the row's actions. */
function Row({
  row,
  t,
  reconnecting,
  onReconnect,
  onRemove,
}: {
  row: RowData
  t: Translate
  reconnecting: boolean
  onReconnect: () => void
  onRemove: () => void
}): ReactNode {
  return (
    <div className={css.row} data-testid={`mcp-row-${row.serverName}`}>
      <div className={css.rowMain}>
        <span className={css.rowName}>{row.serverName}</span>
        <span className={clsx(css.badge, STATUS_CLASS[row.status])}>
          {statusText(row.status, t)}
        </span>
        <span className={css.rowTools}>{toolsText(row, t)}</span>
      </div>
      <div className={css.rowActions}>
        <Button variant="outline" size="sm" disabled={reconnecting} onClick={onReconnect}>
          {reconnecting ? t('reconnecting') : t('reconnect')}
        </Button>
        {row.managed && (
          <Button variant="outline" size="sm" className={css.remove} onClick={onRemove}>
            {t('remove')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** The add-server form: the name, the transport switch, and the per-transport fields. */
function AddForm({
  draft,
  rows,
  t,
  actions,
}: {
  draft: AddDraft
  rows: readonly RowData[]
  t: Translate
  actions: Pick<McpSectionInjected, 'cancelAdd' | 'submitAdd' | 'setAddField'>
}): ReactNode {
  const blocker = draftBlocker(draft, rows)
  const message = draft.error ?? (blocker === undefined ? null : t(blocker))
  return (
    <Modal
      open
      onClose={() => { actions.cancelAdd() }}
      title={t('addTitle')}
      closeLabel={t('cancel')}
      description={t('addIntro')}
      className={css.form ?? ''} /* v8 ignore -- the css module exports the form class; the fallback keeps an undecorated build rendering */
      footer={(
        <>
          <Button variant="outline" disabled={draft.saving} onClick={() => { actions.cancelAdd() }}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={draft.saving || blocker !== undefined} onClick={() => { void actions.submitAdd() }}>
            {draft.saving ? t('creating') : t('create')}
          </Button>
        </>
      )}
    >
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('serverName')}</span>
        <input
          className={css.input}
          value={draft.serverName}
          placeholder={t('serverNamePlaceholder')}
          onChange={(event) => { actions.setAddField('serverName', event.currentTarget.value) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('transport')}</span>
        <select
          className={css.input}
          value={draft.transport}
          onChange={(event) => { actions.setAddField('transport', event.currentTarget.value as AddDraft['transport']) }}
        >
          <option value="stdio">{t('stdio')}</option>
          <option value="streamable-http">{t('streamableHttp')}</option>
        </select>
      </label>
      {draft.transport === 'stdio' ? (
        <>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('command')}</span>
            <input
              className={css.input}
              value={draft.command}
              placeholder={t('commandPlaceholder')}
              onChange={(event) => { actions.setAddField('command', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('args')}</span>
            <textarea
              className={css.input}
              rows={2}
              value={draft.args}
              placeholder={t('argsPlaceholder')}
              onChange={(event) => { actions.setAddField('args', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('env')}</span>
            <textarea
              className={css.input}
              rows={2}
              value={draft.env}
              placeholder={t('envPlaceholder')}
              onChange={(event) => { actions.setAddField('env', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('cwd')}</span>
            <input
              className={css.input}
              value={draft.cwd}
              placeholder={t('cwdPlaceholder')}
              onChange={(event) => { actions.setAddField('cwd', event.currentTarget.value) }}
            />
          </label>
        </>
      ) : (
        <>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('url')}</span>
            <input
              className={css.input}
              value={draft.url}
              placeholder={t('urlPlaceholder')}
              onChange={(event) => { actions.setAddField('url', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('headers')}</span>
            <textarea
              className={css.input}
              rows={2}
              value={draft.headers}
              placeholder={t('headersPlaceholder')}
              onChange={(event) => { actions.setAddField('headers', event.currentTarget.value) }}
            />
          </label>
        </>
      )}
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('timeout')}</span>
        <input
          className={css.input}
          inputMode="numeric"
          value={draft.timeoutMs}
          placeholder={t('timeoutPlaceholder')}
          onChange={(event) => { actions.setAddField('timeoutMs', event.currentTarget.value) }}
        />
      </label>
      {message !== null && <p className={css.error}>{message}</p>}
    </Modal>
  )
}

/**
 * Render the MCP settings section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function McpSection(props: McpSectionProps): ReactNode {
  const {
    useMcpSection, t, load, beginAdd, cancelAdd, setAddField, submitAdd, beginRemove, setRemoveAcknowledged, remove, reconnect,
  } = props
  const state = useMcpSection(snapshot => snapshot)

  useEffect(() => { void load() }, [load])

  const pending = state.pendingRemove === null
    ? undefined
    : state.rows.find(row => row.serverName === state.pendingRemove)

  return (
    <div className={css.section}>
      <div className={css.header}>
        <p className={css.intro}>{t('sectionIntro')}</p>
        <Button variant="outline" size="sm" onClick={() => { beginAdd() }}>
          <IconPlusOutline16 size={14} />
          {t('add')}
        </Button>
      </div>
      {state.status === 'loading' && <p className={css.note}>{t('loading')}</p>}
      {state.status === 'error' && (
        <div className={css.note}>
          <span>{state.error ?? t('loadError')}</span>
          <Button variant="outline" size="sm" onClick={() => { void load() }}>{t('retry')}</Button>
        </div>
      )}
      {state.status === 'ready' && state.rows.length === 0 && <p className={css.note}>{t('noServers')}</p>}
      {state.status === 'ready' && state.rows.length > 0 && (
        <div className={css.list}>
          {state.rows.map(row => (
            <Row
              key={row.serverName}
              row={row}
              t={t}
              reconnecting={state.reconnecting === row.serverName}
              onReconnect={() => { void reconnect(row.serverName) }}
              onRemove={() => { beginRemove(row.serverName) }}
            />
          ))}
        </div>
      )}
      {state.add !== null && (
        <AddForm draft={state.add} rows={state.rows} t={t} actions={{ cancelAdd, submitAdd, setAddField }} />
      )}
      {pending !== undefined && (
        <RiskConfirmation
          open
          title={t('removeTitle', { name: pending.serverName })}
          description={t('removeDescription')}
          acknowledgeLabel={t('removeAcknowledge')}
          cancelLabel={t('removeCancel')}
          confirmLabel={state.removing ? t('removing') : t('removeConfirm')}
          acknowledged={state.removeAcknowledged}
          disabled={state.removing}
          onAcknowledgedChange={(value) => { setRemoveAcknowledged(value) }}
          onCancel={() => { beginRemove(null) }}
          onConfirm={() => { void remove() }}
        />
      )}
    </div>
  )
}
