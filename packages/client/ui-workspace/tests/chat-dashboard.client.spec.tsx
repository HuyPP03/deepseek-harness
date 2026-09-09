// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId, SessionListState, WorkspaceListState } from '@open-harness/oh-client-runtime/client'
import { en } from '../src/client/locales.ts'
import type { ChatDashboardProps } from '../src/client/contract/slots.ts'
import { ChatDashboard } from '../src/client/ChatDashboard.tsx'

const sid = (id: string) => id as SessionId

/** English-dictionary translate stub: assertions query the rendered en copy. */
const t: ChatDashboardProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name as keyof typeof params] ?? ''))
}

function summary(id: string, displayTitle: string, updatedAt: number, extra: Partial<SessionListState['byId'][SessionId]> = {}) {
  return { id: sid(id), displayTitle, running: false, blank: false, updatedAt, ...extra } as SessionListState['byId'][SessionId]
}

function sessionList(): SessionListState {
  const s1 = summary('s1', 'Older chat', 1_000_000_000_000, { cwd: '/projects/alpha' })
  const s2 = summary('s2', 'Newer chat', 1_000_000_001_000, { running: true })
  return {
    ids: [s1.id, s2.id],
    byId: { [s1.id]: s1, [s2.id]: s2 },
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function workspaceList(): WorkspaceListState {
  return {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }
}

function mount({ list = sessionList(), presetIds = new Set<string>() }: {
  list?: SessionListState
  presetIds?: ReadonlySet<string>
} = {}) {
  const openSession = vi.fn()
  const startChat = vi.fn()
  const view = render(
    <ChatDashboard
      t={t}
      useSessions={((sel: (s: SessionListState) => unknown) => sel(list)) as never}
      useWorkspaces={((sel: (s: WorkspaceListState) => unknown) => sel(workspaceList())) as never}
      useConnectorPresetIds={((sel: (s: ReadonlySet<string>) => unknown) => sel(presetIds)) as never}
      openSession={openSession}
      startChat={startChat}
    />,
  )
  return { openSession, startChat, ...view }
}

afterEach(cleanup)

describe('ChatDashboard', () => {
  it('lists the recent chats newest-first and opens the clicked session', () => {
    const m = mount()
    // The CTA is the only non-row button; the rows keep DOM (recency) order.
    const rows = screen.getAllByRole('button').filter(b => b !== screen.getByRole('button', { name: 'New Chat' }))
    expect(rows[0]!.textContent).toContain('Newer chat')
    expect(rows[1]!.textContent).toContain('Older chat')
    // The count label counts the listed rows.
    expect(screen.getByText('2 chats')).toBeTruthy()
    // Workspace label: the project basename, or the plain-chat fallback.
    expect(rows[0]!.textContent).toContain('Plain chat')
    expect(rows[1]!.textContent).toContain('alpha')
    // The running row exposes its status to the accessibility tree.
    expect(rows[0]!.textContent).toContain('Running')
    fireEvent.click(rows[1]!)
    expect(m.openSession).toHaveBeenCalledWith('s1')
  })

  it('shows the empty state when there are no chats', () => {
    const list = sessionList()
    mount({ list: { ...list, ids: [], byId: {} } })
    expect(screen.getByText('No chats yet')).toBeTruthy()
    expect(screen.queryByText('2 chats')).toBeNull()
  })

  it('the New chat call to action starts a chat', () => {
    const { startChat } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }))
    expect(startChat).toHaveBeenCalledOnce()
  })

  it('hides the sessions of connected connectors', () => {
    const list = sessionList()
    const s3 = summary('s3', 'Provider chat', 1_000_000_002_000, { agentPreset: 'preset-mcp' })
    list.ids.push(s3.id)
    list.byId[s3.id] = s3
    mount({ list, presetIds: new Set(['preset-mcp']) })
    expect(screen.queryByText('Provider chat')).toBeNull()
    expect(screen.getByText('2 chats')).toBeTruthy()
  })

  it('lists the current blank chat under the localized New Chat label', () => {
    const list = sessionList()
    const b1 = summary('b1', 'New Chat', 1_000_000_003_000, { agentPreset: 'chat', blank: true })
    list.ids.push(b1.id)
    list.byId[b1.id] = b1
    list.current = b1.id
    mount({ list })
    // The blank row (newest, first) renders the localized label; its
    // accessible name carries the meta and time, so count the rows instead.
    const rows = screen.getAllByRole('button').filter(b => b !== screen.getByRole('button', { name: 'New Chat' }))
    expect(rows).toHaveLength(3)
    expect(rows[0]!.textContent).toContain('New Chat')
    expect(screen.getByText('3 chats')).toBeTruthy()
  })

  it('shows the singular count and the now time bucket', () => {
    const list = sessionList()
    const s1 = summary('s1', 'Just now', Date.now())
    list.ids = [s1.id]
    list.byId = { [s1.id]: s1 }
    mount({ list })
    expect(screen.getByText('1 chat')).toBeTruthy()
    expect(screen.getByText('now')).toBeTruthy()
  })

  it('localizes the non-chat blank variant and falls back for an empty cwd', () => {
    const list = sessionList()
    // A blank row on any other preset (the workspace-provisional variant):
    // the New Session label.
    const b1 = summary('b1', 'New Session', 1_000_000_004_000, { blank: true })
    list.ids.push(b1.id)
    list.byId[b1.id] = b1
    list.current = b1.id
    // An empty-string cwd: the basename projection is empty, so the meta
    // falls back to the plain-chat label.
    const noCwd = list.ids.find(id => list.byId[id]?.displayTitle === 'Newer chat')!
    list.byId[noCwd] = { ...list.byId[noCwd]!, cwd: '' }
    mount({ list })
    const rows = screen.getAllByRole('button').filter(b => b !== screen.getByRole('button', { name: 'New Chat' }))
    expect(rows[0]!.textContent).toContain('New Session')
    expect(rows[1]!.textContent).toContain('Plain chat')
    expect(screen.getByText('3 chats')).toBeTruthy()
  })
})
