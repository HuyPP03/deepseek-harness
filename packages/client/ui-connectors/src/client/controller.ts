/**
 * Connectors region controller: the roster as a list of secret-free views, a
 * token dialog as the only way a token connector is configured, and row
 * actions for connect and disconnect.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page adopts the response's updated view into the roster — the
 * response is authoritative, so no re-list follows (the host derives the view
 * from the same catalog, credentials, and live registry state this page
 * renders).
 */

import type { ConnectorView, IApiClient, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The token dialog: one secret field per credential reference over a fixed connector. */
export interface ConnectTokenDialog {
  /** The connector id the draft belongs to. */
  id: string
  /** Display name for the dialog title. */
  name: string
  /** The token method's obtaining instructions, absent when it has none. */
  howTo: string | null
  /** The draft value per credential reference, in the method's declared order; cleared by the next open. */
  drafts: Record<string, string>
  /** Whether the save is in flight. */
  saving: boolean
  /** The last save failure, cleared by the next edit. */
  error: string | null
}

/** The one row-level operation failure; cleared by the next operation on it. */
export interface RowOpError {
  /** The failed connector id. */
  id: string
  /** The host's error message to render under the row. */
  message: string
}

/** Page snapshot the renderer subscribes to. */
export interface ConnectorsSectionState {
  /** Roster read lifecycle; an error keeps the last good roster if one was shown. */
  status: 'loading' | 'ready' | 'error'
  /** The roster read failure, cleared by a successful read. */
  error: string | null
  /** The secret-free views, in the host's id order. */
  connectors: readonly ConnectorView[]
  /** The row with an operation in flight, absent when none. */
  busyId: string | null
  /** The row-level operation failure, absent when none. */
  opError: RowOpError | null
  /** The open token dialog, absent when closed. */
  dialog: ConnectTokenDialog | null
}

const INITIAL: ConnectorsSectionState = {
  status: 'loading',
  error: null,
  connectors: [],
  busyId: null,
  opError: null,
  dialog: null,
}

/**
 * The roster page controller: fetch, adopt responses, and drive the token
 * dialog. Owned by the apply closure; the renderer binds its store through
 * the inject `hooks` compartment.
 */
export class ConnectorsSectionController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<ConnectorsSectionState> = createSnapshotStore(INITIAL)

  // Only the operations the region drives; the wider connector domain
  // (complete, add, remove) stays host-side until the flow engine lands.
  constructor(private readonly api: { connectors: Pick<IApiClient['connectors'], 'list' | 'configure' | 'connect' | 'disconnect' | 'authorize'> }) {}

  private get state(): ConnectorsSectionState {
    return this.store.getSnapshot()
  }

  private set(patch: Partial<ConnectorsSectionState>): void {
    this.store.set({ ...this.state, ...patch })
  }

  /**
   * Adopt one updated view into the roster (the mutation responses carry the
   * authoritative post-operation view). A view for a roster the page has not
   * loaded yet is dropped: the next read reconstitutes it.
   * @param view - the response's connector view.
   */
  private withView(view: ConnectorView): void {
    if (!this.state.connectors.some(c => c.id === view.id)) return
    this.set({ connectors: this.state.connectors.map(c => (c.id === view.id ? view : c)) })
  }

  /**
   * Read the roster. A deployment composing no connectors answers an empty
   * roster, which is a valid deployment rather than a failure — the region
   * then shows its empty state.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const response = await this.api.connectors.list({})
    if (!response.result.ok) {
      this.set({ status: 'error', error: response.result.error.message })
      return
    }
    this.set({ status: 'ready', error: null, connectors: [...response.result.value.connectors] })
  }

  /**
   * Open the token dialog over one connector's unconfigured token method.
   * Non-token rows and already-configured ones have no dialog.
   * @param id - the connector to configure.
   */
  openTokenDialog(id: string): void {
    const row = this.state.connectors.find(c => c.id === id)
    const token = row === undefined ? undefined : row.auth.find(a => a.mode === 'token')
    if (row === undefined || token === undefined || token.configured) return
    const drafts: Record<string, string> = {}
    /* v8 ignore next -- credentialRefs is optional only for wire consumers that predate it; a shipped host always fills it */
    for (const ref of token.credentialRefs ?? []) drafts[ref] = ''
    this.set({
      dialog: {
        id, name: row.name, howTo: token.howTo ?? null,
        drafts, saving: false, error: null,
      },
    })
  }

  /**
   * Name the draft one credential reference is typing; clears a previous save failure.
   * @param ref - the credential reference the field belongs to.
   * @param value - the value so far.
   */
  setDialogDraft(ref: string, value: string): void {
    const { dialog } = this.state
    if (dialog === null) return
    this.set({ dialog: { ...dialog, drafts: { ...dialog.drafts, [ref]: value }, error: null } })
  }

  /** Close the dialog, discarding the draft. */
  closeDialog(): void {
    if (this.state.dialog === null) return
    this.set({ dialog: null })
  }

  /**
   * Store the dialog's token and adopt the updated view. A failure keeps the
   * dialog open over its draft.
   * @returns once the store carries the host's answer.
   */
  async saveToken(): Promise<void> {
    const { dialog } = this.state
    if (dialog === null || dialog.saving) return
    this.set({ dialog: { ...dialog, saving: true, error: null } })
    const response = await this.api.connectors.configure({
      id: dialog.id,
      fields: { credentials: { ...dialog.drafts } },
    })
    if (!response.result.ok) {
      this.set({ dialog: { ...dialog, saving: false, error: response.result.error.message } })
      return
    }
    this.withView(response.result.value.connector)
    this.set({ dialog: null })
  }

  /**
   * One row operation's shared lifecycle: the single-flight guard, the busy
   * mark, the unwrap (a failure records its message on the row), and the
   * response view's adoption.
   * @param id - the row the operation belongs to.
   * @param call - the wire call whose answer carries the updated view.
   * @returns once the store carries the host's answer.
   */
  private async runRowOperation(id: string, call: () => Promise<RpcResponse<{ connector: ConnectorView }>>): Promise<void> {
    if (this.state.busyId !== null) return
    this.set({ busyId: id, opError: null })
    const response = await call()
    if (!response.result.ok) {
      this.set({ busyId: null, opError: { id, message: response.result.error.message } })
      return
    }
    this.withView(response.result.value.connector)
    this.set({ busyId: null })
  }

  /**
   * Mount the named connector's servers through its stored credentials.
   * @param id - the connector to connect.
   * @param mode - the auth mode to connect through.
   * @returns once the store carries the host's answer.
   */
  async connect(id: string, mode: 'token' | 'oauth' | 'device' = 'token'): Promise<void> {
    return this.runRowOperation(id, () => this.api.connectors.connect({ id, mode }))
  }

  /**
   * Begin the named connector's browser OAuth flow: the host returns the
   * authorization URL and the flow expiry. The caller opens the URL in a
   * new tab; the host's loopback callback settles the exchange server-side
   * and the connector view transitions to `connected` (or `error`).
   * @param id - the connector to authorize.
   * @returns the authorization URL and the flow's expiry timestamp.
   */
  async authorize(id: string): Promise<{ authorizationUrl: string; expiresAt: number }> {
    const response = await this.api.connectors.authorize({ id })
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value
  }

  /**
   * Unmount the named connector's servers and forget its stored credential.
   * @param id - the connector to disconnect.
   * @returns once the store carries the host's answer.
   */
  async disconnect(id: string): Promise<void> {
    return this.runRowOperation(id, () => this.api.connectors.disconnect({ id }))
  }
}
