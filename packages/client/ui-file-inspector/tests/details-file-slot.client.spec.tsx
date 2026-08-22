// @vitest-environment jsdom
// The file inspector's acceptance chain on the REAL machinery stack:
// SlotTestRuntime (cordis Context + SlotRegistry ledger + the web-react
// renderer) + the ui-conversation and ui-file-inspector applies — no outlet
// twins. Proves the conversation.details.file seat end to end: the occupant
// lands through slots.inject once the details entry declares it, a file
// selection routed by the details panel renders the inspector, the Code seat
// reads through the provided fileBytes service, and the Changes seat appears
// when the window holds a diff card for the file.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import type { ISession, SessionId, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyInspector, inject as injectInspector } from '@deepseek-ai/dsh-client-ui-file-inspector/client'

const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the virtual view and the composer seat publish through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  // The chat store persists under its declared key; a previous bench's
  // selection would rehydrate into this one.
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

/** Test-owned AppFrame role: declares and renders the resident conversation and details areas. */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}{renderSlot('details', {})}</>
}

const LAYOUT_CHILDREN = {
  'conversation': { kind: 'single', scope: 'session-maybe' },
  'details': { kind: 'single', scope: 'session' },
} as const

/** The snapshot's chat slice over the given settled nodes (the test's own minimal builder). */
function chatSnapshot(settled: readonly ToolResultNode[]) {
  const empty: readonly string[] = []
  return {
    order: [] as string[],
    nodes: { get: () => undefined, values: () => [] },
    locations: { getTurn: () => empty, getStep: () => empty },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: { nodes: settled, runningCalls: [], partial: null, turnTimings: new Map(), turnEnds: new Map() },
  }
}

/** The settled write card whose diff touches the selected file. */
const diffResult = (seq: number, path: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId: `c${seq}`,
  call: { name: 'write', argsRaw: '{}' }, callTime: seq * 1_000 - 500,
  content: [], isError: false, callView: null,
  resultView: { card: 'diff', diffs: [{ path, oldText: 'old line', newText: 'changed line', oldStart: 1, newStart: 1, lang: 'ts' }] },
  subCalls: [],
})

/**
 * Real-stack bench: SlotTestRuntime with the session/layout doubles at the
 * service boundaries only, both package applies on their own fibers, the
 * fileBytes service faked at its boundary, and the test AppFrame occupying
 * 'root'. `filesList` stands in for the connection's files.list RPC (the
 * file list seat's fetch); `cwd` records the session's working directory
 * (the header Files action's browse root).
 */
async function bench(
  nodes: readonly ToolResultNode[],
  filesList?: () => Promise<unknown>,
  cwd?: string,
) {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', {
    api: { settings: {}, ...(filesList === undefined ? {} : { files: { list: filesList } }) },
    isLoopback: false,
  })
  // ui-theme's Appearance row binds a durable scope through these two.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layout)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const read = vi.fn(async (_sessionId: SessionId, path: string) => ({
    path, bytes: new TextEncoder().encode(`real ${path}\n`), contentType: 'text/plain', size: 12,
  }))
  const url = vi.fn((_sessionId: SessionId, path: string) => `/api/file/${SID}/${encodeURIComponent(path)}`)
  runtime.provide('fileBytes', { read, url, clear: vi.fn() })
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S', ...(cwd === undefined ? {} : { cwd }) },
    snapshot: { nodes, chat: chatSnapshot(nodes) },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectInspector], apply: applyInspector })
  return { runtime, read, layout, url }
}

/** Match a line whose complete text content is `t` (shiki splits lines into runs). */
const lineText = (t: string) => (_: string, el: Element | null): boolean =>
  el !== null && el.tagName === 'SPAN' && el.textContent === t

describe('conversation.details.file seat through the real machinery', () => {
  it('routes a file selection to the inspector and reads through the provided service', async () => {
    const b = await bench([])
    const view = b.runtime.renderRoot()
    // The seat is registered; a file selection routes through the details
    // panel to the inspector.
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 1, filePath: '/tmp/proj/main.ts' })
    await b.runtime.flush()
    expect(view.getByText('main.ts')).toBeTruthy()
    // No diff in the window: the single-tab seat renders no strip.
    expect(view.queryByRole('tablist')).toBeNull()
    expect(await view.findByText(lineText('real /tmp/proj/main.ts'))).toBeTruthy()
    expect(b.read).toHaveBeenCalledWith(SID, '/tmp/proj/main.ts', expect.anything())
    await b.runtime.dispose()
  })

  it('shows the Changes seat when the window holds a diff card for the file', async () => {
    const b = await bench([diffResult(3, '/tmp/proj/main.ts')])
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 1, filePath: '/tmp/proj/main.ts' })
    await b.runtime.flush()
    expect(view.getByText('Changes')).toBeTruthy()
    expect(view.getByText('Code')).toBeTruthy()
    expect(await view.findByText(lineText('changed line'))).toBeTruthy()
    await b.runtime.dispose()
  })

  it('selecting a different file remounts the seat (fresh view state)', async () => {
    const b = await bench([])
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 1, filePath: '/tmp/proj/first.ts' })
    await b.runtime.flush()
    expect(view.getByText('first.ts')).toBeTruthy()
    details.actions.select({ turnSeq: 2, filePath: '/tmp/proj/second.ts' })
    await b.runtime.flush()
    expect(view.getByText('second.ts')).toBeTruthy()
    expect(view.queryByText('first.ts')).toBeNull()
    expect(b.read.mock.calls.map(c => c[1])).toEqual(['/tmp/proj/first.ts', '/tmp/proj/second.ts'])
    await b.runtime.dispose()
  })

  it('routes a browse selection to the file list and a row opens the inspector', async () => {
    const list = vi.fn(async () => ({
      result: {
        ok: true,
        value: {
          files: [
            { path: '/tmp/proj/docs', relative: 'docs', root: 'workspace', isDirectory: true },
            { path: '/tmp/proj/out.txt', relative: 'out.txt', root: 'workspace', isDirectory: false },
          ],
          truncated: false,
        },
      },
    }))
    const b = await bench([], list, '/tmp/proj')
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 0, browse: '/tmp/proj' })
    await b.runtime.flush()
    // The list seat fetched through the connection face and rendered rows:
    // the directory as inert context, the file as an opener.
    expect(list).toHaveBeenCalledTimes(1)
    expect(view.getByText('docs/').tagName).toBe('SPAN')
    expect(view.getByRole('button', { name: 'out.txt' })).toBeTruthy()
    // A row click re-selects the file: the inspector seat takes over and
    // reads through the file-bytes service.
    fireEvent.click(view.getByRole('button', { name: 'out.txt' }))
    await b.runtime.flush()
    expect(await view.findByText(lineText('real /tmp/proj/out.txt'))).toBeTruthy()
    expect(b.read).toHaveBeenCalledWith(SID, '/tmp/proj/out.txt', expect.anything())
    await b.runtime.dispose()
  })

  it('opens the file list from the header Files button through the detailsPanel service', async () => {
    const list = vi.fn(async () => ({
      result: { ok: true, value: { files: [], truncated: false } },
    }))
    const b = await bench([], list, '/tmp/proj')
    const view = b.runtime.renderRoot()
    // The header action is present (the session records a cwd) and is the
    // only button under that name (the details title is not a control).
    const buttons = view.getAllByRole('button', { name: 'Session files' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    await b.runtime.flush()
    expect(b.layout.openDetails).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(1)
    expect(view.getByText('No files to show in this directory')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('shows no Files button for a session without a cwd', async () => {
    const b = await bench([], undefined, undefined)
    const view = b.runtime.renderRoot()
    expect(view.queryByRole('button', { name: 'Session files' })).toBeNull()
    await b.runtime.dispose()
  })

  it('surfaces the list failure state when the walk RPC fails', async () => {
    const list = vi.fn(async () => ({
      result: { ok: false, error: { code: 'internal', message: 'walk refused', details: {} } },
    }))
    const b = await bench([], list, '/tmp/proj')
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 0, browse: '/tmp/proj' })
    await b.runtime.flush()
    expect(await view.findByText('The file list failed to load')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('points an image selection at the raw channel URL', async () => {
    const b = await bench([])
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 1, filePath: '/tmp/proj/pix.png' })
    await b.runtime.flush()
    const img = await view.findByRole('img', { name: '/tmp/proj/pix.png' })
    expect(img.getAttribute('src')).toBe(`/api/file/${SID}/${encodeURIComponent('/tmp/proj/pix.png')}`)
    expect(b.url).toHaveBeenCalledWith(SID, '/tmp/proj/pix.png')
    await b.runtime.dispose()
  })
})
