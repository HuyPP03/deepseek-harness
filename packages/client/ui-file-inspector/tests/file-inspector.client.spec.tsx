// @vitest-environment jsdom
// FileInspector's presentation behavior over direct props: the tab strip
// appears only when the window holds a diff for the file, the Changes seat
// is the default then, the Code seat walks its loading/ok/error/binary/empty
// states, and the virtualized lines carry numbers and text.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationNode, ConversationSnapshot, SessionId, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { FileBytesError } from '@deepseek-ai/dsh-client-runtime/client'
import { FileInspector } from '../src/client/FileInspector.tsx'
import type { FileInspectorProps } from '../src/client/FileInspector.tsx'
import { zh } from '../src/client/locales.ts'

const SID = 's1' as SessionId
const PATH = '/tmp/proj/src/main.ts'

/** A settled diff card for the selected file. */
const diffCard = (seq: number): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId: `c${seq}`,
  call: { name: 'write', argsRaw: '{}' }, callTime: seq * 1_000 - 500,
  content: [], isError: false, callView: null,
  resultView: {
    card: 'diff',
    diffs: [{ path: 'src/main.ts', oldText: 'old line', newText: 'new line', oldStart: 1, newStart: 1, lang: 'ts' }],
  },
  subCalls: [],
})

/** The snapshot the stub useSession serves. */
const snapshotOf = (nodes: readonly ConversationNode[]): ConversationSnapshot => ({
  sessionId: SID, views: {}, chat: null as unknown as ConversationSnapshot['chat'], nodes,
} as unknown as ConversationSnapshot)

/** Render the inspector with direct props over a scripted byte read. */
type ReadResult = { bytes: Uint8Array; contentType: string; size: number }
function renderInspector(nodes: readonly ConversationNode[], read: (path: string) => Promise<ReadResult>) {
  const readFile = vi.fn(read)
  const useSession = <S,>(selector: (s: ConversationSnapshot) => S): S => selector(snapshotOf(nodes))
  const props: FileInspectorProps = {
    path: PATH,
    cwd: '/tmp/proj',
    readFile,
    useSession,
    sessionId: SID,
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
  const view = render(<FileInspector {...props} />)
  return { view, readFile }
}

const okBytes = (text: string) => ({
  bytes: new TextEncoder().encode(text),
  contentType: 'text/plain',
  size: new TextEncoder().encode(text).byteLength,
})

/** Match a line whose complete text content is `t` (shiki splits lines into runs). */
const lineText = (t: string) => (_: string, el: Element | null): boolean =>
  el !== null && el.tagName === 'SPAN' && el.textContent === t

afterEach(cleanup)
beforeEach(() => {
  // jsdom has no ResizeObserver; the virtual view measures through one.
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
})

describe('tab strip', () => {
  it('shows no strip and the code seat when the window holds no diff', async () => {
    renderInspector([], p => Promise.resolve(okBytes(`const x = ${p}\n`)))
    expect(screen.queryByText('变更')).toBeNull()
    expect(screen.queryByText('代码')).toBeNull()
    expect(await screen.findByText(lineText('const x = /tmp/proj/src/main.ts'))).toBeTruthy()
  })

  it('offers both seats with Changes active when the window holds a diff', async () => {
    renderInspector([diffCard(3)], p => Promise.resolve(okBytes(`unused ${p}\n`)))
    expect(screen.getByText('变更')).toBeTruthy()
    expect(screen.getByText('代码')).toBeTruthy()
    // The default seat draws the diff card's changed line.
    expect(await screen.findByText(lineText('new line'))).toBeTruthy()
    expect(screen.queryByText(lineText('unused /tmp/proj/src/main.ts'))).toBeNull()
  })

  it('switches seats on tab click', async () => {
    const { view } = renderInspector([diffCard(3)], p => Promise.resolve(okBytes(`code ${p}\n`)))
    fireEvent.click(screen.getByText('代码'))
    expect(await screen.findByText(lineText('code /tmp/proj/src/main.ts'))).toBeTruthy()
    // The changes seat unmounted with its tab.
    expect(view.queryByText(lineText('new line'))).toBeNull()
    fireEvent.click(screen.getByText('变更'))
    expect(await screen.findByText(lineText('new line'))).toBeTruthy()
  })
})

describe('code seat states', () => {
  it('walks loading to the decoded lines with numbers', async () => {
    let settle!: (value: { bytes: Uint8Array; contentType: string; size: number }) => void
    const { view } = renderInspector([], () => new Promise((r) => { settle = r }))
    expect(screen.getByText('载入文件…')).toBeTruthy()
    await act(async () => { settle(okBytes('line one\nline two\n')) })
    expect((await screen.findAllByText(lineText('line one'))).length).toBeGreaterThan(0)
    expect(screen.getAllByText(lineText('line two')).length).toBeGreaterThan(0)
    expect(screen.getByText('2')).toBeTruthy()
    expect(view.queryByText('载入文件…')).toBeNull()
  })

  it('notices binary content instead of decoding', async () => {
    renderInspector([], () => Promise.resolve(okBytes('abc\u0000def\nrest\n')))
    expect(await screen.findByText('二进制文件，无代码视图')).toBeTruthy()
  })

  it('shows the empty-file state', async () => {
    renderInspector([], () => Promise.resolve(okBytes('')))
    expect(await screen.findByText('空文件')).toBeTruthy()
  })

  it('maps the 413 refusal to the over-bound state', async () => {
    renderInspector([], () => Promise.reject(new FileBytesError(413, 'too large')))
    expect(await screen.findByText('文件超过 25 MiB 边界，无法在检视器中显示')).toBeTruthy()
  })

  it('maps other refusals to the unreadable state', async () => {
    renderInspector([], () => Promise.reject(new FileBytesError(500, 'unreadable')))
    expect(await screen.findByText('文件不可读（权限或平台错误）')).toBeTruthy()
  })

  it('maps non-FileBytes rejections to the unreadable state', async () => {
    renderInspector([], () => Promise.reject(new Error('boom')))
    expect(await screen.findByText('文件不可读（权限或平台错误）')).toBeTruthy()
  })
})
