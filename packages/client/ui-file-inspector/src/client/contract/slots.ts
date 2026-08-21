/**
 * File inspector contract: the details-panel seat's props and the inject
 * face the registrant feeds its component. The seat is declared by
 * ui-conversation's 'details' entry (owner: the selected file's canonical
 * absolute path plus the display-only workspace root); this package's
 * occupant reads the bytes through the runtime's file-bytes service and
 * derives the Changes tab from the session snapshot's diff cards.
 * @module @deepseek-ai/dsh-client-ui-file-inspector/client/contract
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the seat's owner params).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The seat's full props: the owner share, the standard locale seat, and the injected read face. */
export type FileInspectorProps = PropsRuntime<'conversation.details.file'> & PropsLocale<'fileInspector'> & FileInspectorInjected

/**
 * The inject face: plain callbacks over the runtime's file-bytes service.
 * The component never sees the service (ctx discipline) — the apply closure
 * closes over it and hands the component a read bound to the seat's session.
 */
export interface FileInspectorInjected {
  /**
   * Read one file's bytes (cached; concurrent reads share one fetch).
   * @param path - the file's canonical absolute path.
   * @param signal - optional cancellation for the underlying fetch.
   * @returns the bytes, content type, and size, or a FileBytesError on refusal.
   */
  readFile: (path: string, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; contentType: string; size: number }>
}
