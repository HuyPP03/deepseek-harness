/** Shared conversation view, selection, and store-state contracts. */

/** Tool call identity as carried on the wire (branded upstream in connection). */
export type CallId = string

/**
 * Selection target for the details linkage channel (a tool call is the step
 * special case). `callId` and `filePath` name mutually exclusive occupants:
 * a call selection renders the tool output seat, a file selection (a
 * workspace-rooted or attached-reference absolute path) renders the file
 * inspector seat. Persisted targets older than either field rehydrate as a
 * no-op selection for that field.
 */
export interface SelectionTarget {
  turnSeq: number
  stepSeq?: number
  callId?: CallId
  toolName?: string
  /** The file the inspector seat should open (a `callId`-less target). */
  filePath?: string
}

/**
 * One conversation view tab, projected from a 'conversation.view' slot
 * entry's registration options (label falls back to the entry id).
 */
export interface ViewTab { id: string; label: string }

/**
 * Per-session state shared by conversation, chat-view, and details slots.
 * Unknown persisted view ids fall back to the stable Chat view.
 */
export interface ChatStoreState {
  /** Details-linkage channel (conversation writes, details reads). */
  selection: SelectionTarget | null
  /** Composer draft (persisted; survives session switches and reloads). */
  draft: string
  /** Active conversation view id ('conversation.view' entry id); null falls back to Chat. */
  view: string | null
  /**
   * One-shot inspect handoff: chat writes the call to reveal, the trajectory
   * view consumes it and acknowledges by clearing. Read with `?? null` —
   * persisted snapshots from before this field rehydrate without it.
   */
  inspect: { callId: CallId } | null
}
