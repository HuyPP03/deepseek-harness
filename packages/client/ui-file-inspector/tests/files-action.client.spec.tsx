// @vitest-environment jsdom
// FilesAction's presentation behavior over direct props: the session-header
// Files button renders only for a session that records a cwd, and its click
// hands the session's own working directory to the open gesture.

import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { FilesAction } from '../src/client/FilesAction.tsx'
import type { FilesActionProps } from '../src/client/FilesAction.tsx'
import { zh } from '../src/client/locales.ts'

const SID = 's1' as SessionId
const CWD = '/home/u/.dsh/chat/s1'

/** Render the action with a sessions-list stub over one session's cwd. */
function renderAction(cwd: string | undefined, openBrowse = vi.fn()) {
  const props: FilesActionProps = {
    sessionId: SID,
    openBrowse,
    useSession: () => { throw new Error('unused') },
    useSessions: selector => selector({ byId: { [SID]: { ...(cwd === undefined ? {} : { cwd }) } } } as SessionListState),
    useWorkspaces: () => { throw new Error('unused') },
    useProjection: () => undefined,
    useInput: () => { throw new Error('unused') },
    inputActions: {
      setDraft: () => {},
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit: () => {},
    },
    t: (key: string) => zh[key as keyof typeof zh],
  }
  const view = render(<FilesAction {...props} />)
  return { view, openBrowse }
}

afterEach(cleanup)

describe('header Files action', () => {
  it('renders nothing for a session with no cwd', () => {
    renderAction(undefined)
    expect(screen.queryByRole('button', { name: '会话文件' })).toBeNull()
  })

  it('renders the button and hands the session cwd to the open gesture', () => {
    const { openBrowse } = renderAction(CWD)
    const button = screen.getByRole('button', { name: '会话文件' })
    fireEvent.click(button)
    expect(openBrowse).toHaveBeenCalledWith(CWD)
  })
})
