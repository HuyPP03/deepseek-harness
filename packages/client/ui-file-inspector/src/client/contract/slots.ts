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
// Type-only: the files.list RPC row shape the browser lists through.
import type { FileEntry } from '@deepseek-ai/dsh-api-remotes/client'

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
  /**
   * Same-origin raw channel URL of one file. Preview surfaces (image, SVG,
   * HTML frame) point the element's src here directly: the browser decodes
   * the bytes without a JS copy.
   * @param path - the file's canonical absolute path.
   * @returns the raw channel URL string.
   */
  fileUrl: (path: string) => string
}

/** The session file list seat's full props. */
export type FileBrowserProps = PropsRuntime<'conversation.details.files'> & PropsLocale<'fileInspector'> & FileBrowserInjected

/**
 * The file list seat's inject face: the session's working-set listing (the
 * same bounded walk the composer's `@` source fetches) and the opener that
 * turns a row into an inspector file selection.
 */
export interface FileBrowserInjected {
  /**
   * List the session's working-set files and directories (host bounded
   * walk: depth 8, 20000 scanned, 100 rows; dot entries and the skip list
   * are pruned host-side).
   * @param signal - optional cancellation for the underlying RPC.
   * @returns the rows (workspace-relative or reference-rooted) and whether
   * the scan bound cut the walk short.
   */
  listFiles: (signal?: AbortSignal) => Promise<{ rows: readonly FileEntry[]; truncated: boolean }>
  /**
   * Open one listed file in the inspector (replaces the browse selection
   * with the file selection and keeps the panel open).
   * @param path - the row's canonical absolute path.
   */
  openFile: (path: string) => void
}
