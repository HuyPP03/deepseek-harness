/**
 * The connectors dialogs: the token dialog (one secret field per credential
 * reference over a fixed connector, with the token method's obtaining
 * instructions as the description) and the custom connector dialog (one form
 * over the AddCustomSpec fields). Both are draft forms over the controller's
 * dialog state; the token dialog is the only place a credential value enters
 * the client.
 */
import type { ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectOauthDialog, ConnectTokenDialog, CustomConnectorDialog } from './controller.ts'
import type { ConnectorsTranslate } from './contract/slots.ts'
import css from './Dialogs.module.css'

/** Token dialog props: the drafts plus the actions that mutate them. */
interface TokenDialogProps {
  dialog: ConnectTokenDialog
  t: ConnectorsTranslate
  onClose: () => void
  onDraft: (ref: string, value: string) => void
  onSave: () => Promise<void>
}

/**
 * Render the token dialog.
 * @param props - the drafts, the copy, and the mutations.
 * @returns the modal.
 */
export function TokenDialog({ dialog, t, onClose, onDraft, onSave }: TokenDialogProps): ReactNode {
  const refs = Object.keys(dialog.drafts)
  const allDrafted = refs.length > 0 && Object.values(dialog.drafts).every(value => value.trim() !== '')
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
            disabled={dialog.saving || !allDrafted}
            onClick={() => { void onSave() }}
          >
            {dialog.saving ? t('dialog.saving') : t('dialog.save')}
          </Button>
        </div>
      )}
    >
      {refs.map(ref => (
        <div className={css.dialogField} key={ref}>
          <span className={css.dialogFieldLabel}>{ref}</span>
          <Input
            type="password"
            value={dialog.drafts[ref]}
            placeholder={t('dialog.tokenPlaceholder')}
            onChange={(event) => { onDraft(ref, event.target.value) }}
          />
        </div>
      ))}
      {dialog.error !== null && <span className={css.dialogError}>{dialog.error}</span>}
    </Modal>
  )
}

/** OAuth app dialog props: the client id/secret drafts plus the actions. */
interface OauthAppDialogProps {
  dialog: ConnectOauthDialog
  t: ConnectorsTranslate
  onClose: () => void
  onDraft: (field: 'clientId' | 'clientSecret', value: string) => void
  onSave: () => Promise<void>
}

/**
 * Render the byoApp setup dialog: the provider's app-registration steps,
 * then the client id (and optional client secret) fields.
 * @param props - the drafts, the copy, and the mutations.
 * @returns the modal.
 */
export function OauthAppDialog({ dialog, t, onClose, onDraft, onSave }: OauthAppDialogProps): ReactNode {
  const valid = dialog.clientId.trim() !== ''
  return (
    <Modal
      open
      onClose={onClose}
      title={t('dialog.setup.title', { name: dialog.name })}
      closeLabel={t('dialog.cancel')}
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
            disabled={dialog.saving || !valid}
            onClick={() => { void onSave() }}
          >
            {dialog.saving ? t('dialog.saving') : t('dialog.setup.save')}
          </Button>
        </div>
      )}
    >
      {dialog.setupGuide.length > 0 && (
        <ol className={css.setupSteps}>
          {dialog.setupGuide.map(step => <li key={step}>{step}</li>)}
        </ol>
      )}
      <div className={css.dialogField}>
        <span className={css.dialogFieldLabel}>{t('dialog.setup.clientId')}</span>
        <Input
          type="text"
          value={dialog.clientId}
          placeholder={t('dialog.setup.clientIdPlaceholder')}
          onChange={(event) => { onDraft('clientId', event.target.value) }}
        />
      </div>
      <div className={css.dialogField}>
        <span className={css.dialogFieldLabel}>{t('dialog.setup.clientSecret')}</span>
        <Input
          type="password"
          value={dialog.clientSecret}
          onChange={(event) => { onDraft('clientSecret', event.target.value) }}
        />
        <span className={css.dialogFieldHint}>{t('dialog.setup.secretHint')}</span>
      </div>
      {dialog.error !== null && <span className={css.dialogError}>{dialog.error}</span>}
    </Modal>
  )
}

/**
 * Render the custom connector dialog: one form over the AddCustomSpec fields
 * (name, id, transport, command/args or url, optional token var).
 * @param props - the dialog state and the controller's draft mutators.
 * @returns the modal.
 */
export function CustomDialog({ dialog, t, onClose, onDraft, onSave }: {
  dialog: CustomConnectorDialog
  t: ConnectorsTranslate
  onClose: () => void
  onDraft: (field: string, value: string) => void
  onSave: () => Promise<void>
}): ReactNode {
  const d = dialog.drafts
  const isHttp = d.transport === 'streamable-http'
  const valid = d.name.trim() !== ''
    && (isHttp || d.command.trim() !== '')
    && (!isHttp || d.url.trim() !== '')
  return (
    <Modal
      open
      onClose={onClose}
      title={t('custom.new.title')}
      closeLabel={t('dialog.cancel')}
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
            disabled={dialog.saving || !valid}
            onClick={() => { void onSave() }}
          >
            {dialog.saving ? t('custom.new.saving') : t('custom.new.save')}
          </Button>
        </div>
      )}
    >
      <div className={css.dialogField}>
        <span className={css.dialogFieldLabel}>{t('custom.new.name')}</span>
        <Input
          type="text"
          value={d.name}
          placeholder="My Service"
          onChange={(e) => { onDraft('name', e.target.value) }}
        />
      </div>
      <div className={css.dialogField}>
        <span className={css.dialogFieldLabel}>{t('custom.new.id')}</span>
        <Input
          type="text"
          value={d.id}
          placeholder="my-service"
          onChange={(e) => { onDraft('id', e.target.value) }}
        />
      </div>
      <div className={css.dialogField}>
        <span className={css.dialogFieldLabel}>{t('custom.new.transport')}</span>
        <div className={css.customTransport}>
          <label>
            <input
              type="radio"
              name="transport"
              value="stdio"
              checked={!isHttp}
              onChange={() => { onDraft('transport', 'stdio') }}
            />
            {t('custom.new.transport.stdio')}
          </label>
          <label>
            <input
              type="radio"
              name="transport"
              value="streamable-http"
              checked={isHttp}
              onChange={() => { onDraft('transport', 'streamable-http') }}
            />
            {t('custom.new.transport.http')}
          </label>
        </div>
      </div>
      {!isHttp && (
        <div className={css.dialogField}>
          <span className={css.dialogFieldLabel}>{t('custom.new.command')}</span>
          <Input
            type="text"
            value={d.command}
            placeholder="npx"
            onChange={(e) => { onDraft('command', e.target.value) }}
          />
        </div>
      )}
      {!isHttp && (
        <div className={css.dialogField}>
          <span className={css.dialogFieldLabel}>{t('custom.new.args')}</span>
          <Input
            type="text"
            value={d.args}
            placeholder="-y, @example/mcp-server"
            onChange={(e) => { onDraft('args', e.target.value) }}
          />
        </div>
      )}
      {isHttp && (
        <div className={css.dialogField}>
          <span className={css.dialogFieldLabel}>{t('custom.new.url')}</span>
          <Input
            type="text"
            value={d.url}
            placeholder="https://example.com/mcp"
            onChange={(e) => { onDraft('url', e.target.value) }}
          />
        </div>
      )}
      <div className={css.dialogField}>
        <span className={css.dialogFieldLabel}>{t('custom.new.tokenVar')}</span>
        <Input
          type="text"
          value={d.tokenVar}
          placeholder="MY_SERVICE_TOKEN"
          onChange={(e) => { onDraft('tokenVar', e.target.value) }}
        />
      </div>
      {isHttp && (
        <div className={css.dialogField}>
          <label>
            <input
              type="checkbox"
              checked={d.tokenVarIsHeader === 'true'}
              onChange={(e) => { onDraft('tokenVarIsHeader', e.target.checked ? 'true' : 'false') }}
            />
            {t('custom.new.tokenVarIsHeader')}
          </label>
        </div>
      )}
      {dialog.error !== null && <span className={css.dialogError}>{dialog.error}</span>}
    </Modal>
  )
}
