// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  SessionId, SessionListState, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@open-harness/oh-client-runtime/client'
import { en } from '../src/client/locales.ts'
import type { WorkspaceDashboardProps } from '../src/client/contract/slots.ts'
import { WorkspaceDashboard } from '../src/client/WorkspaceDashboard.tsx'

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

/** English-dictionary translate stub: assertions query the rendered en copy. */
const t: WorkspaceDashboardProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name as keyof typeof params] ?? ''))
}

function workspace(id: string, path: string, title: string, sessionIds: readonly string[]): WorkspaceView {
  return {
    workspaceId: wid(id), path, title,
    sessionIds: sessionIds.map(sid),
    createdAt: String(1_000_000_000_000), updatedAt: String(1_000_000_000_000),
  } as WorkspaceView
}

function sessions(...entries: [id: string, updatedAt: number, extra?: Record<string, unknown>][]): Pick<SessionListState, 'ids' | 'byId'> {
  const byId = {} as SessionListState['byId']
  const ids = entries.map(([id, updatedAt, extra]) => {
    byId[sid(id)] = {
      id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, ...extra,
    } as SessionListState['byId'][SessionId]
    return sid(id)
  })
  return { ids, byId }
}

function mount({ items, sessionState, current = undefined }: {
  items: readonly WorkspaceView[]
  sessionState?: Pick<SessionListState, 'ids' | 'byId'>
  current?: SessionId
}) {
  const openSession = vi.fn()
  const startSession = vi.fn()
  const list: SessionListState = {
    ...(sessionState ?? { ids: [], byId: {} }),
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaces: WorkspaceListState = {
    items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }
  const view = render(
    <WorkspaceDashboard
      t={t}
      useSessions={((sel: (s: SessionListState) => unknown) => sel(list)) as never}
      useWorkspaces={((sel: (s: WorkspaceListState) => unknown) => sel(workspaces)) as never}
      openSession={openSession}
      startSession={startSession}
    />,
  )
  return { openSession, startSession, ...view }
}

afterEach(cleanup)

describe('WorkspaceDashboard', () => {
  it('renders one card per workspace and opens the clicked card newest session', () => {
    const now = Date.now()
    const { openSession } = mount({
      items: [workspace('ws-a', '/projects/alpha', 'Alpha', ['s1', 's2'])],
      sessionState: sessions(['s1', now - 2 * 3_600_000], ['s2', now - 30_000]),
    })
    const card = screen.getByRole('button', { name: /Alpha/ })
    expect(card.textContent).toContain('/projects/alpha')
    expect(card.textContent).toContain('2 sessions')
    // The card exposes its newest activity (s2, 30s old) as the now bucket.
    expect(card.textContent).toContain('now')
    fireEvent.click(card)
    // s2 is the newest non-blank session.
    expect(openSession).toHaveBeenCalledWith('s2')
  })

  it('starts a session when the card holds no sessions', () => {
    const { startSession, openSession } = mount({
      items: [workspace('ws-b', '/projects/beta', 'Beta', [])],
    })
    const card = screen.getByRole('button', { name: /Beta/ })
    expect(card.textContent).toContain('0 sessions')
    fireEvent.click(card)
    expect(startSession).toHaveBeenCalledWith('ws-b')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('starts a session for a blank-only card instead of opening the blank row', () => {
    const { startSession, openSession } = mount({
      items: [workspace('ws-c', '/projects/gamma', 'Gamma', ['b1'])],
      sessionState: sessions(['b1', 1_000_000_003_000, { blank: true }]),
      current: sid('b1'),
    })
    const card = screen.getByRole('button', { name: /Gamma/ })
    fireEvent.click(card)
    expect(startSession).toHaveBeenCalledWith('ws-c')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('shows the empty state when there are no workspaces', () => {
    mount({ items: [] })
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeTruthy()
    expect(screen.getByText('Folders that group their sessions.')).toBeTruthy()
    expect(screen.getByText('No workspaces yet')).toBeTruthy()
    expect(screen.getByText('Add a folder to group its sessions.')).toBeTruthy()
  })

  it('shows the singular counts for a lone workspace with a lone session', () => {
    mount({
      items: [workspace('ws-d', '/projects/delta', 'Delta', ['s9'])],
      sessionState: sessions(['s9', Date.now()]),
    })
    expect(screen.getByText('1 workspace')).toBeTruthy()
    const card = screen.getByRole('button', { name: /Delta/ })
    expect(card.textContent).toContain('1 session')
  })

  it('shows the plural workspace count', () => {
    // ws-1 lists its newest session first: the scan must skip the older
    // second row without displacing it.
    const now = Date.now()
    mount({
      items: [workspace('ws-1', '/projects/p1', 'P1', ['n1', 'n2']), workspace('ws-2', '/projects/p2', 'P2', [])],
      sessionState: sessions(['n1', now - 60_000], ['n2', now - 120_000]),
    })
    expect(screen.getByText('2 workspaces')).toBeTruthy()
  })
})
