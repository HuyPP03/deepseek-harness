// @vitest-environment jsdom
// FileBrowser's presentation behavior over direct props: the one-fetch list
// renders its rows (directories muted, files openable), the filter input
// narrows the window locally, and the loading/error/empty/truncated states
// each render their own copy.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { FileBrowser } from '../src/client/FileBrowser.tsx'
import type { FileBrowserProps } from '../src/client/FileBrowser.tsx'
import { zh } from '../src/client/locales.ts'

const SID = 's1' as SessionId
const DIR = '/home/u/.dsh/chat/s1'

const row = (relative: string, isDirectory = false, root: FileEntry['root'] = 'workspace'): FileEntry => ({
  path: `${DIR}/${relative}`,
  relative,
  root,
  isDirectory,
})

const ROWS: readonly FileEntry[] = [
  row('notes/docs', true),
  row('git-commands.docx'),
  row('notes/plan.md'),
]

/** Render the browser with direct props over a scripted listing. */
type ListResult = { rows: readonly FileEntry[]; truncated: boolean }
function renderBrowser(
  listFiles: (signal?: AbortSignal) => Promise<ListResult>,
  openFile = vi.fn(),
) {
  const props: FileBrowserProps = {
    dir: DIR,
    cwd: DIR,
    listFiles,
    openFile,
    sessionId: SID,
    useSession: () => { throw new Error('unused') },
    useSessions: () => { throw new Error('unused') },
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
  const view = render(<FileBrowser {...props} />)
  return { view, openFile }
}

afterEach(cleanup)

describe('file list seat', () => {
  it('shows the loading state until the one fetch settles', async () => {
    let settle: (value: ListResult) => void = () => {}
    renderBrowser(() => new Promise((resolve) => { settle = resolve }))
    expect(screen.getByText('载入文件列表…')).toBeTruthy()
    await act(async () => { settle({ rows: ROWS, truncated: false }) })
    expect(screen.queryByText('载入文件列表…')).toBeNull()
    expect(screen.getByText('git-commands.docx')).toBeTruthy()
  })

  it('lists files as open rows and directories as muted context', async () => {
    const { openFile } = renderBrowser(() => Promise.resolve({ rows: ROWS, truncated: false }))
    expect(await screen.findByText('git-commands.docx')).toBeTruthy()
    expect(screen.getByText('notes/plan.md')).toBeTruthy()
    // The directory row is inert context (a span, not a control).
    expect(screen.getByText('notes/docs/').tagName).toBe('SPAN')
    expect(screen.queryByRole('button', { name: 'notes/docs/' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'git-commands.docx' }))
    expect(openFile).toHaveBeenCalledWith('/home/u/.dsh/chat/s1/git-commands.docx')
  })

  it('prefaces a non-workspace root with its root name', async () => {
    const { openFile } = renderBrowser(() => Promise.resolve({
      rows: [row('shared/pix.png', false, 'ref')], truncated: false,
    }))
    expect(await screen.findByRole('button', { name: 'ref/shared/pix.png' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ref/shared/pix.png' }))
    expect(openFile).toHaveBeenCalledWith('/home/u/.dsh/chat/s1/shared/pix.png')
  })

  it('narrows the window locally as the filter input changes', async () => {
    renderBrowser(() => Promise.resolve({ rows: ROWS, truncated: false }))
    await screen.findByText('git-commands.docx')
    const filter = screen.getByPlaceholderText('过滤文件…')
    fireEvent.change(filter, { target: { value: 'plan' } })
    expect(screen.queryByText('git-commands.docx')).toBeNull()
    expect(screen.getByText('notes/plan.md')).toBeTruthy()
    // A filter that matches nothing shows the empty copy, not a blank list.
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(screen.getByText('此目录下没有可显示的文件')).toBeTruthy()
  })

  it('shows the error copy when the walk fails', async () => {
    renderBrowser(() => Promise.reject(new Error('walk refused')))
    await waitFor(() => { expect(screen.getByText('文件列表加载失败')).toBeTruthy() })
  })

  it('shows the truncated note beside the capped window', async () => {
    renderBrowser(() => Promise.resolve({ rows: [row('a.txt')], truncated: true }))
    expect(await screen.findByText('a.txt')).toBeTruthy()
    expect(screen.getByText('仅显示前 100 条（列表被截断）')).toBeTruthy()
  })

  it('ignores a listing that settles after the seat unmounts', async () => {
    let settle: (value: ListResult) => void = () => {}
    const { view } = renderBrowser(() => new Promise((resolve) => { settle = resolve }))
    view.unmount()
    await act(async () => { settle({ rows: ROWS, truncated: false }) })
  })

  it('ignores a failed listing that rejects after the seat unmounts', async () => {
    let reject: (reason: unknown) => void = () => {}
    const { view } = renderBrowser(() => new Promise((_, r) => { reject = r }))
    view.unmount()
    await act(async () => { reject(new Error('walk refused')) })
  })
})
