/**
 * ui-connectors contracts. Two registrants over one controller: the sidebar
 * shell's `sidebar.connectors` hole hosts the compact connected-providers
 * list, and the frame's `main.connectors` hole (the full-column overlay above
 * the center column, shown while the layout's centerView is 'connectors')
 * hosts the connectors directory — the big browse cards with their possible
 * failure modes, and the selected provider's detail. Business data and
 * actions arrive through each registrant's own inject face (the controller's
 * snapshot store via the `hooks` compartment plus the mutation callbacks).
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the sidebar shell's SlotMap merge ('sidebar.connectors')
// and the frame's ('main.connectors') into programs that resolve the
// runtime share below.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConnectorsSectionState } from '../controller.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * The shared callback set the directory drives: the roster read, the row
 * actions (configure / connect / disconnect / remove), the provider
 * selection, and the provider-detail session actions.
 */
export interface ConnectorsDirectoryCallbacks {
  /** Read the roster; called once when the directory first renders. */
  load: () => Promise<void>
  /** Open the token dialog over one connector's unconfigured token method. */
  openTokenDialog: (id: string) => void
  /** Name the draft one credential reference is typing. */
  setDialogDraft: (ref: string, value: string) => void
  /** Close the dialog, discarding the draft. */
  closeDialog: () => void
  /** Store the dialog's token and adopt the updated view. */
  saveToken: () => Promise<void>
  /** Open the OAuth app (byoApp) dialog over one connector's unconfigured pre-registered-app method. */
  openOauthDialog: (id: string) => void
  /** Name the draft one app field is typing. */
  setOauthDraft: (field: 'clientId' | 'clientSecret', value: string) => void
  /** Close the OAuth app dialog, discarding the draft. */
  closeOauthDialog: () => void
  /** Store the dialog's client id (and secret) and adopt the updated view. */
  saveOauth: () => Promise<void>
  /** Mount one connector's servers through the given auth mode. */
  connect: (id: string, mode: 'token' | 'oauth' | 'device') => Promise<void>
  /** Begin one connector's browser OAuth flow; returns the URL to open and the flow expiry. */
  authorize: (id: string) => Promise<{ authorizationUrl: string; expiresAt: number }>
  /** Begin one connector's device-code flow; returns the sign-in facts for the user. */
  deviceLogin: (id: string) => Promise<{
    status: 'device-code' | 'ready'
    verificationUri?: string
    userCode?: string
    message?: string
    expiresAt: number
  }>
  /** Unmount one connector's servers and forget its stored credential. */
  disconnect: (id: string) => Promise<void>
  /** Select a provider to view its detail; null returns to the grid. */
  selectProvider: (id: string | null) => void
  /** Open the custom connector dialog over an empty draft. */
  openCustomDialog: () => void
  /** Name the draft one form field is typing. */
  setCustomDraft: (field: string, value: string) => void
  /** Close the custom dialog, discarding the draft. */
  closeCustomDialog: () => void
  /** Persist the dialog's draft through connector.add and re-list. */
  saveCustom: () => Promise<void>
  /** Remove one custom connector and re-list. */
  removeCustom: (id: string) => Promise<void>
  /** Open one session in the main conversation area. */
  openSession: (id: SessionId) => void
  /** Mint a blank session under the provider's preset and open it. */
  newProviderChat: (providerId: string) => Promise<void>
}

/** Registration-side business face for the sidebar's connected-providers list. */
export interface ConnectedProvidersListInjected {
  /** The controller's snapshot store; the renderer binds it to the hook. */
  hooks: {
    /** Roster page snapshot bound by the renderer as useConnectors. */
    connectors: SnapshotStore<ConnectorsSectionState>
  }
  /** Read the roster; called once when the list first renders. */
  load: () => Promise<void>
  /** Select a provider so the directory in the main area shows its detail. */
  selectProvider: (id: string | null) => void
}

/** Registration-side business face for the connectors directory. */
export type ConnectorsDirectoryInjected = {
  /** The controller's snapshot store; the renderer binds it to the hook. */
  hooks: {
    /** Roster page snapshot bound by the renderer as useConnectors. */
    connectors: SnapshotStore<ConnectorsSectionState>
  }
} & ConnectorsDirectoryCallbacks

/**
 * Full component props for the sidebar list: the shell's column state (the
 * slot owner share), the copy, and the face.
 */
export type ConnectedProvidersListProps =
  PropsRuntime<'sidebar.connectors'>
  & PropsLocale<'connectors'>
  & InjectFace<ConnectedProvidersListInjected>

/**
 * Full component props for the main-area directory: no owner share (the slot
 * takes none), the copy, and the face.
 */
export type ConnectorsDirectoryProps =
  PropsRuntime<'main.connectors'>
  & PropsLocale<'connectors'>
  & InjectFace<ConnectorsDirectoryInjected>

/** The connectors namespace translate (the shared dialog components take it as a plain prop). */
export type ConnectorsTranslate = PropsLocale<'connectors'>['t']
