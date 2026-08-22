// FilesAction: the session header's entry point into the session file list.
// The button opens the details panel on the session's own working directory
// (the chat sandbox for a plain chat), where the file list seat shows every
// file the session can address — including files a shell command created,
// which no mutation tool announced. It renders nothing for a session with no
// cwd to browse.

import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './FilesAction.module.css'

/** Registration-side business face: the details-panel open gesture. */
export interface FilesActionInjected {
  /**
   * Open the details panel on the session file list for the session that
   * rendered this action.
   * @param dir - the canonical absolute path of the directory to browse.
   */
  openBrowse: (dir: string) => void
}

/** Full component props for the header Files button. */
export type FilesActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'fileInspector'>
  & InjectFace<FilesActionInjected>

/**
 * The session-header entry point for this session's file list.
 * @param props - runtime slot currency (sessionId, useSessions), the injected
 *   open gesture, and the namespace translator.
 * @returns the Files button, or null when the session has no cwd to browse.
 */
export function FilesAction({ sessionId, useSessions, openBrowse, t }: FilesActionProps) {
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  if (cwd === undefined) return null
  return (
    <button
      type="button"
      className={css.action}
      aria-label={t('action.files')}
      title={t('action.files')}
      onClick={() => { openBrowse(cwd) }}
    >
      <IconFolderOpenOutline16 size={14} className={css.icon} />
      <span>{t('action.files')}</span>
    </button>
  )
}
