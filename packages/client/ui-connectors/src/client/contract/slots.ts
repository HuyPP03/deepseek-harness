/**
 * ui-connectors contracts. The registration fills the sidebar shell's
 * `sidebar.connectors` hole (the whole connectors browsing region, shown
 * while the shell's active tab is 'connectors'): a section header, the
 * roster rows with state dots, and the token dialog. Business data and
 * actions arrive through the region's own inject (the controller's snapshot
 * store via the `hooks` compartment plus the mutation callbacks).
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the sidebar shell's SlotMap merge ('sidebar.connectors')
// into programs that resolve the runtime share below.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ConnectorsSectionState } from '../controller.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Registration-side business face for the connectors region. */
export interface ConnectorsRegionInjected {
  /** The controller's snapshot store; the renderer binds it to the hook. */
  hooks: {
    /** Roster page snapshot bound by the renderer as useConnectors. */
    connectors: SnapshotStore<ConnectorsSectionState>
  }
  /** Read the roster; called once when the region first renders. */
  load: () => Promise<void>
  /** Open the token dialog over one connector's unconfigured token method. */
  openTokenDialog: (id: string) => void
  /** Name the draft one credential reference is typing. */
  setDialogDraft: (ref: string, value: string) => void
  /** Close the dialog, discarding the draft. */
  closeDialog: () => void
  /** Store the dialog's token and adopt the updated view. */
  saveToken: () => Promise<void>
  /** Mount one connector's servers through the given auth mode. */
  connect: (id: string, mode: 'token' | 'oauth' | 'device') => Promise<void>
  /** Begin one connector's browser OAuth flow; returns the URL to open and the flow expiry. */
  authorize: (id: string) => Promise<{ authorizationUrl: string; expiresAt: number }>
  /** Unmount one connector's servers and forget its stored credential. */
  disconnect: (id: string) => Promise<void>
  /** Select a provider to view its sessions; null returns to the provider list. */
  selectProvider: (id: string | null) => void
}

/** Full component props: the shell's column state, the copy, and the face. */
export type ConnectorsRegionProps =
  PropsRuntime<'sidebar.connectors'>
  & PropsLocale<'connectors'>
  & InjectFace<ConnectorsRegionInjected>
