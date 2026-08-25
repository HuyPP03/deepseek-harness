// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId, SessionListState, WorkspaceId, WorkspaceListState, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from '../src/client/contract/slots.ts'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { WorkspacePickFlow, WorkspacePicker } from '../src/client/WorkspacePicker.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is workspace ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: WorkspacePickerProps['t'] = makeTranslate(zh, commonZh)

const wid = (id: string) => id as WorkspaceId
const PLAIN = '不选择项目（普通聊天）'
const ADD = '添加工作区…'
const START = '开始'

function workspace(id: string, title = id): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}
const workspaceState = (items: readonly WorkspaceView[], phase: 'ready' | 'pending' = 'ready'): WorkspaceListState => ({
  items, archivedSessionIds: [], state: 'idle', phase, error: null, baselinesReady: phase === 'ready',
  recentWorkspaceId: items[0]?.workspaceId,
})
const sessions: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
}
function anchor(): { current: HTMLElement } {
  const element = document.createElement('button')
  element.getBoundingClientRect = () => ({
    top: 10, left: 20, width: 30, height: 40, right: 50, bottom: 50,
    x: 20, y: 10, toJSON: () => ({}),
  })
  return { current: element }
}

/**
 * Probe occupant of the directory-flow hole: records the latest owner
 * conversation so tests drive onPicked/onCancel/onError like a composed flow
 * package would, and renders a marker element while the flow is open.
 */
function flowProbe() {
  const probe: { owner: DirectoryFlowOwnerProps | undefined } = { owner: undefined }
  const renderSlot = (_name: string, rawOwner: object) => {
    const owner = rawOwner as DirectoryFlowOwnerProps
    probe.owner = owner
    return owner.open ? <div data-testid="directory-flow" data-busy={owner.busy} /> : null
  }
  return { probe, renderSlot }
}

/** Manual occupancy source bound like the renderer would: flip() drives the hook like a real registration change. */
function occupancySource(initial = true) {
  let occupied = initial
  const listeners = new Set<() => void>()
  const useDirectoryFlow = bindSnapshotSelector({
    getSnapshot: () => occupied,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
  return {
    useDirectoryFlow,
    flip: (next: boolean) => {
      occupied = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A selected row carries the trailing check icon as its last child (the leading icon lives in its own span). */
function isChecked(row: HTMLElement): boolean {
  const last = row.lastElementChild
  return last !== null && last.tagName === 'svg'
}

interface FlowMountOptions {
  /** Listed workspaces; one Alpha entry by default. */
  items?: readonly WorkspaceView[]
  /** List phase — pending keeps the menu up with its loading status. */
  phase?: 'ready' | 'pending'
  /** Creation callback (the adoption outcome). */
  createWorkspace?: (input: { path: string }) => Promise<WorkspaceView>
  /** Directory-flow occupancy source (the add action gate). */
  occupancy?: { useDirectoryFlow: <S>(selector: (state: boolean) => S) => S; flip: (next: boolean) => void }
  /** The owner-preselected workspace (multi: seeds the initial main). */
  selectedId?: WorkspaceId | undefined
  /** Popover visibility (open by default). */
  open?: boolean
  /** Omit the anchor element (the menu waits for placement). */
  noAnchor?: boolean
  /** Single mode only: offer the add action, hide existing workspaces. */
  addOnly?: boolean
  /** The session the hero belongs to (multi: drives the provider-chat hide). */
  sessions?: SessionListState
  /** The connector preset ids (multi: a member current preset hides the picker). */
  connectorPresetIds?: ReadonlySet<string>
}

/**
 * Mount the flow under either confirmation mode: multi (the hero's
 * WorkspacePicker registration) or single (WorkspacePickFlow as the
 * WorkspaceBrowser consumes it). rerender() re-renders with overrides.
 */
function mountFlow(kind: 'single' | 'multi', options: FlowMountOptions = {}) {
  const onPick = vi.fn()
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  const occupancy = options.occupancy ?? occupancySource()
  const createWorkspace = options.createWorkspace ?? vi.fn()
  const { probe, renderSlot } = flowProbe()
  // Stable preset-id source for the provider-chat guard; the default is empty
  // (no connectors composed), so the picker renders as before.
  const presetIds = options.connectorPresetIds ?? new Set<string>()
  const useConnectorPresetIds = bindSnapshotSelector({
    getSnapshot: () => presetIds,
    subscribe: () => () => undefined,
  })
  const renderFrame = (next: FlowMountOptions) => {
    const items = next.items ?? options.items ?? [workspace('alpha', 'Alpha')]
    const phase = next.phase ?? options.phase ?? 'ready'
    const open = next.open ?? options.open ?? true
    const anchorRef = next.noAnchor ?? options.noAnchor ? undefined : anchor()
    const sessionList = next.sessions ?? options.sessions ?? sessions
    return kind === 'multi'
      ? (
        <WorkspacePicker
          open={open}
          anchorRef={anchorRef}
          useSessions={hook(sessionList)}
          useWorkspaces={hook(workspaceState(items, phase))}
          selectedId={next.selectedId ?? options.selectedId}
          onConfirm={onConfirm}
          createWorkspace={createWorkspace}
          useDirectoryFlow={occupancy.useDirectoryFlow}
          useConnectorPresetIds={useConnectorPresetIds}
          renderSlot={renderSlot}
          t={t}
        />
      )
      : (
        <WorkspacePickFlow
          t={t}
          open={open}
          anchorRef={anchorRef}
          useWorkspaces={hook(workspaceState(items, phase))}
          createWorkspace={createWorkspace}
          useDirectoryFlow={occupancy.useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('conversation.hero.workspace.directoryFlow', owner)}
          onClose={onClose}
          addOnly={next.addOnly ?? options.addOnly ?? false}
          onPick={onPick}
        />
      )
  }
  const view = render(renderFrame(options))
  return {
    view, onPick, onConfirm, onClose, probe, occupancy, createWorkspace,
    rerender: (next: FlowMountOptions) => { view.rerender(renderFrame(next)) },
  }
}

function chooseAdd(): void {
  fireEvent.click(screen.getByRole('menuitem', { name: ADD }))
}

describe('WorkspacePicker (multi-select New-Session flow)', () => {
  it('lists plain chat first, then the projects, and keeps Start last', () => {
    mountFlow('multi', { items: [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')] })
    expect(screen.getAllByRole('menuitem').map(row => row.textContent))
      .toEqual([PLAIN, 'Alpha', 'Beta', ADD, START])
    expect(isChecked(screen.getByRole('menuitem', { name: PLAIN }))).toBe(true)
    expect(isChecked(screen.getByRole('menuitem', { name: 'Alpha' }))).toBe(false)
  })

  it('checks rows in click order and submits main plus references on Start', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha'), workspace('beta', 'Beta'), workspace('gamma', 'Gamma')] })
    fireEvent.click(screen.getByRole('menuitem', { name: /^Alpha/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Beta/ }))
    expect(isChecked(screen.getByRole('menuitem', { name: /^Alpha/ }))).toBe(true)
    expect(screen.getByRole('menuitem', { name: /^Alpha/ }).textContent).toContain('主项目')
    expect(screen.getByRole('menuitem', { name: /^Beta/ }).textContent).not.toContain('主项目')
    fireEvent.click(screen.getByRole('menuitem', { name: START }))
    expect(b.onConfirm).toHaveBeenCalledWith({ main: wid('alpha'), references: [wid('beta')] })
  })

  it('moves the main badge to the first checked row when the main is unchecked', () => {
    mountFlow('multi', { items: [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')] })
    fireEvent.click(screen.getByRole('menuitem', { name: /^Alpha/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Beta/ }))
    expect(screen.getByRole('menuitem', { name: /^Alpha/ }).textContent).toContain('主项目')
    fireEvent.click(screen.getByRole('menuitem', { name: /^Alpha/ }))
    expect(screen.getByRole('menuitem', { name: /^Alpha/ }).textContent).not.toContain('主项目')
    expect(screen.getByRole('menuitem', { name: /^Beta/ }).textContent).toContain('主项目')
  })

  it('caps the selection at one main plus two references, until an uncheck frees a slot', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha'), workspace('beta', 'Beta'), workspace('gamma', 'Gamma'), workspace('delta', 'Delta')] })
    for (const name of ['Alpha', 'Beta', 'Gamma']) fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }))
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: /^Delta/ }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: START }))
    expect(b.onConfirm).toHaveBeenCalledWith({ main: wid('alpha'), references: [wid('beta'), wid('gamma')] })
    fireEvent.click(screen.getByRole('menuitem', { name: /^Alpha/ }))
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: /^Delta/ }).disabled).toBe(false)
  })

  it('submits plain chat when Start is pressed with nothing checked', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')] })
    fireEvent.click(screen.getByRole('menuitem', { name: START }))
    expect(b.onConfirm).toHaveBeenCalledWith({ references: [] })
  })

  it('clears the checked rows when the plain-chat row is chosen', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')] })
    fireEvent.click(screen.getByRole('menuitem', { name: /^Alpha/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: PLAIN }))
    expect(isChecked(screen.getByRole('menuitem', { name: PLAIN }))).toBe(true)
    expect(isChecked(screen.getByRole('menuitem', { name: /^Alpha/ }))).toBe(false)
    fireEvent.click(screen.getByRole('menuitem', { name: START }))
    expect(b.onConfirm).toHaveBeenCalledWith({ references: [] })
  })

  it('confirms null when the menu closes unconfirmed (outside click or Escape)', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')] })
    fireEvent.pointerDown(document.body)
    expect(b.onConfirm).toHaveBeenCalledWith(null)
    const c = mountFlow('multi', { items: [workspace('alpha', 'Alpha')] })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(c.onConfirm).toHaveBeenCalledWith(null)
  })

  it('adopts a created workspace as the main project and starts from there', async () => {
    const created = { ...workspace('adopted'), path: '/tmp/project', title: 'project' }
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')], createWorkspace: vi.fn(async () => created) })
    chooseAdd()
    // Raising the flow closes the popover unconfirmed; the flow itself stays up.
    expect(b.onConfirm).toHaveBeenCalledWith(null)
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    await act(async () => { b.probe.owner!.onPicked('/tmp/project') })
    expect(b.createWorkspace).toHaveBeenCalledWith({ path: '/tmp/project' })
    await waitFor(() => { expect(b.onConfirm).toHaveBeenCalledWith({ main: created.workspaceId, references: [] }) })
    expect(screen.queryByTestId('directory-flow')).toBeNull()
  })

  it('treats flow cancellation as a silent no-op', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')] })
    chooseAdd()
    act(() => { b.probe.owner!.onCancel() })
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
    expect(b.onConfirm).not.toHaveBeenCalledWith({ references: [] })
  })

  it('reports a flow-reported failure in the folder-error surface', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')] })
    chooseAdd()
    act(() => { b.probe.owner!.onError('the host refused the path') })
    expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('the host refused the path')
  })

  it('reports a non-Error adoption failure with a live retry', async () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')], createWorkspace: vi.fn(async () => { throw 'permission denied' }) })
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy() })
    expect(screen.getByRole('alert').textContent).toBe('permission denied')
    expect(b.probe.owner!.open).toBe(false)
    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: '重新选择' }))
    expect(b.probe.owner!.open).toBe(true)
  })

  it('keeps retry inert while the flow occupant is gone, and dismisses on cancel', async () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')], createWorkspace: vi.fn(async () => { throw new Error('adoption failed') }) })
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy() })
    act(() => { b.occupancy.flip(false) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新选择' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables every menu action from flow open through adoption, and reports busy to the flow', async () => {
    let resolve!: (workspace: WorkspaceView) => void
    const pending = new Promise<WorkspaceView>((settle) => { resolve = settle })
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')], createWorkspace: vi.fn(() => pending) })
    chooseAdd()
    for (const name of [PLAIN, /^Alpha/, ADD, START]) {
      expect(screen.getByRole<HTMLButtonElement>('menuitem', { name }).disabled).toBe(true)
    }
    expect(b.probe.owner!.busy).toBe(false)
    act(() => { b.probe.owner!.onPicked('/tmp/project') })
    expect(b.probe.owner!.busy).toBe(true)
    resolve(workspace('adopted'))
    await waitFor(() => { expect(b.onConfirm).toHaveBeenCalledWith({ main: wid('adopted'), references: [] }) })
  })

  it('waits to show its menu until the optional anchor is available', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')], noAnchor: true })
    expect(screen.queryByRole('menu')).toBeNull()
    act(() => { b.rerender({ noAnchor: false }) })
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('shows the plain-chat row and the add action while the workspace list is still in flight', () => {
    mountFlow('multi', { items: [], phase: 'pending' })
    expect(screen.getByRole('status').textContent).toBe('正在加载工作区…')
    expect(screen.getByRole('menuitem', { name: PLAIN })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: ADD })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: START })).toBeTruthy()
  })

  it('offers plain chat and add when nothing is listed', () => {
    mountFlow('multi', { items: [] })
    expect(screen.getByRole('menuitem', { name: PLAIN })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: ADD })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: START })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('omits the add row when no directory-flow occupant is composed, and shows it on activation', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')], occupancy: occupancySource(false) })
    expect(screen.queryByRole('menuitem', { name: ADD })).toBeNull()
    act(() => { b.occupancy.flip(true) })
    expect(screen.getByRole('menuitem', { name: ADD })).toBeTruthy()
  })

  it('seeds the owner-selected workspace as the initial main, waiting for a list that proves it', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha')], selectedId: wid('beta') })
    expect(screen.queryByText('主项目')).toBeNull()
    act(() => { b.rerender({ items: [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')] }) })
    expect(screen.getByRole('menuitem', { name: /^Beta/ }).textContent).toContain('主项目')
    fireEvent.click(screen.getByRole('menuitem', { name: START }))
    expect(b.onConfirm).toHaveBeenCalledWith({ main: wid('beta'), references: [] })
  })

  it('resets an unconfirmed selection on the next open', () => {
    const b = mountFlow('multi', { items: [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')], selectedId: wid('alpha'), open: false })
    expect(screen.queryByRole('menu')).toBeNull()
    act(() => { b.rerender({ open: true }) })
    expect(screen.getByRole('menuitem', { name: /^Alpha/ }).textContent).toContain('主项目')
    fireEvent.click(screen.getByRole('menuitem', { name: /^Alpha/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Beta/ }))
    expect(screen.getByRole('menuitem', { name: /^Beta/ }).textContent).toContain('主项目')
    fireEvent.pointerDown(document.body)
    expect(b.onConfirm).toHaveBeenCalledWith(null)
    act(() => { b.rerender({ open: false }) })
    act(() => { b.rerender({ open: true }) })
    // The cancelled check set did not survive: the seeded pick is main again.
    expect(screen.getByRole('menuitem', { name: /^Alpha/ }).textContent).toContain('主项目')
    expect(screen.getByRole('menuitem', { name: /^Beta/ }).textContent).not.toContain('主项目')
  })

  it('renders nothing when the hero session runs a connector preset (a provider chat has no workspace to choose)', () => {
    const sid = 'sess-github' as SessionId
    const providerSessions: SessionListState = {
      ...sessions,
      current: sid,
      byId: { [sid]: { id: sid, displayTitle: 'GitHub chat', running: false, blank: true, updatedAt: 0, agentPreset: 'preset-github' } },
    }
    mountFlow('multi', { items: [workspace('alpha', 'Alpha')], sessions: providerSessions, connectorPresetIds: new Set(['preset-github']) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the picker for a session that is not a provider chat (preset outside the connector set)', () => {
    const sid = 'sess-plain' as SessionId
    const plainSessions: SessionListState = {
      ...sessions,
      current: sid,
      byId: { [sid]: { id: sid, displayTitle: 'Plain chat', running: false, blank: true, updatedAt: 0, agentPreset: 'preset-default' } },
    }
    mountFlow('multi', { items: [workspace('alpha', 'Alpha')], sessions: plainSessions, connectorPresetIds: new Set(['preset-github']) })
    expect(screen.getByRole('menuitem', { name: PLAIN })).toBeTruthy()
  })

  it('keeps the picker when no session is current (the cold-start workspace-choice flow)', () => {
    // The module-level `sessions` snapshot has current: undefined.
    mountFlow('multi', { items: [workspace('alpha', 'Alpha')], connectorPresetIds: new Set(['preset-github']) })
    expect(screen.getByRole('menuitem', { name: PLAIN })).toBeTruthy()
  })
})
describe('WorkspacePickFlow (single/add flow)', () => {
  it('forwards a row pick to onPick', () => {
    const b = mountFlow('single', { items: [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')] })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(b.onPick).toHaveBeenCalledWith(wid('alpha'))
  })

  it('adopts a created workspace to onPick', async () => {
    const created = { ...workspace('adopted'), path: '/tmp/project', title: 'project' }
    const createWorkspace = vi.fn(async () => created)
    const b = mountFlow('single', { items: [workspace('alpha', 'Alpha')], createWorkspace })
    chooseAdd()
    expect(b.onClose).toHaveBeenCalled()
    await act(async () => { b.probe.owner!.onPicked('/tmp/project') })
    await waitFor(() => { expect(b.onPick).toHaveBeenCalledWith(created.workspaceId) })
  })

  it('makes the anchor gesture the add action when adding is the only entry', () => {
    const b = mountFlow('single', { items: [] })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(b.onClose).toHaveBeenCalled()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
  })

  it('raises the flow directly on add-only surfaces', () => {
    mountFlow('single', { items: [workspace('alpha', 'Alpha')], addOnly: true })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
  })

  it('renders no menu when nothing is listed and the add action is unavailable', () => {
    mountFlow('single', { items: [], occupancy: occupancySource(false) })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('directory-flow')).toBeNull()
  })

  it('keeps the menu up while the list baseline is in flight, then auto-opens when it lands empty', () => {
    const b = mountFlow('single', { items: [], phase: 'pending' })
    expect(screen.getByRole('status').textContent).toBe('正在加载工作区…')
    expect(screen.getByRole('menuitem', { name: ADD })).toBeTruthy()
    act(() => { b.rerender({ phase: 'ready' }) })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
  })

  it('does not re-raise the flow while an adoption is still settling', async () => {
    let resolve!: (workspace: WorkspaceView) => void
    const pending = new Promise<WorkspaceView>((settle) => { resolve = settle })
    const createWorkspace = vi.fn(() => pending)
    const b = mountFlow('single', { items: [], createWorkspace })
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    expect(createWorkspace).not.toHaveBeenCalled()
    b.probe.owner!.onPicked('/one/project')
    expect(createWorkspace).toHaveBeenCalledTimes(1)
    resolve(workspace('adopted'))
    await waitFor(() => { expect(b.onPick).toHaveBeenCalledWith(wid('adopted')) })
    expect(createWorkspace).toHaveBeenCalledTimes(1)
  })
})
