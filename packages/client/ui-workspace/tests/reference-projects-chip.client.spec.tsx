// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RpcResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId, WorkspaceId, WorkspaceListState, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ReferenceProjectsChip, type ReferenceProjectsChipProps } from '../src/client/ReferenceProjectsChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 's-1' as SessionId
const wid = (id: string) => id as WorkspaceId
const t: ReferenceProjectsChipProps['t'] = makeTranslate(zh, commonZh)

/** The host projection value: whole reference set (canonical paths) plus the wire cap. */
type RefView = { references: readonly string[]; limit: number }

const OK: RpcResult<{ accepted: true }> = { ok: true, value: { accepted: true } }

function workspace(id: string, sessionIds: SessionId[] = []): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title: id, sessionIds: [...sessionIds],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

/**
 * Chip seat: the session id, a static workspace list, a static projection
 * value (undefined = capability uncomposed), and the setReferences spy.
 */
function props(
  view: RefView | undefined,
  workspaces: readonly WorkspaceView[],
  setReferences: (ids: readonly WorkspaceId[]) => Promise<RpcResult<{ accepted: true }>> = async () => OK,
) {
  return {
    sessionId: SESSION,
    useWorkspaces: hook({ items: workspaces } as WorkspaceListState),
    useProjection: (key: string) => (key === 'workspaceReferences' ? view : undefined),
    setReferences,
    t,
  } as unknown as ReferenceProjectsChipProps
}

/** A selected row carries the trailing check icon as its last child. */
function isChecked(row: HTMLElement): boolean {
  const last = row.lastElementChild
  return last !== null && last.tagName === 'svg'
}
function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: '参考项目' }))
}

describe('ReferenceProjectsChip visibility', () => {
  it('hides when the capability is uncomposed (projection key absent)', () => {
    const { container } = render(<ReferenceProjectsChip {...props(undefined, [workspace('own', [SESSION])])} />)
    expect(container.innerHTML).toBe('')
  })

  it('hides when no listed workspace owns the session', () => {
    const { container } = render(<ReferenceProjectsChip {...props({ references: [], limit: 2 }, [workspace('own')])} />)
    expect(container.innerHTML).toBe('')
  })

  it('closes an open menu when the capability frame disappears', () => {
    const seats = [workspace('own', [SESSION]), workspace('one')]
    const { rerender } = render(<ReferenceProjectsChip {...props({ references: [], limit: 2 }, seats)} />)
    openMenu()
    expect(screen.getByRole('menu')).toBeTruthy()
    rerender(<ReferenceProjectsChip {...props(undefined, seats)} />)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('button', { name: '参考项目' })).toBeNull()
  })
})

describe('ReferenceProjectsChip trigger', () => {
  it('labels the trigger by the reference count', () => {
    const seats = [workspace('own', [SESSION]), workspace('one'), workspace('two')]
    const { rerender } = render(<ReferenceProjectsChip {...props({ references: [], limit: 2 }, seats)} />)
    expect(screen.getByRole('button', { name: '参考项目' }).textContent).toContain('添加参考项目')
    rerender(<ReferenceProjectsChip {...props({ references: ['/projects/one'], limit: 2 }, seats)} />)
    expect(screen.getByRole('button', { name: '参考项目' }).textContent).toContain('1 个参考项目')
    rerender(<ReferenceProjectsChip {...props({ references: ['/projects/one', '/projects/two'], limit: 2 }, seats)} />)
    expect(screen.getByRole('button', { name: '参考项目' }).textContent).toContain('2 个参考项目')
  })

  it('opens and closes its menu from the trigger', () => {
    render(<ReferenceProjectsChip {...props({ references: [], limit: 2 }, [workspace('own', [SESSION]), workspace('one')])} />)
    openMenu()
    expect(screen.getByRole('menu')).toBeTruthy()
    openMenu()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes its menu on Escape and on an outside pointer down', () => {
    render(<ReferenceProjectsChip {...props({ references: [], limit: 2 }, [workspace('own', [SESSION]), workspace('one')])} />)
    openMenu()
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu()
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ReferenceProjectsChip menu', () => {
  it('lists every other workspace, checks the referenced ones, and keeps the own project out', () => {
    const seats = [workspace('own', [SESSION]), workspace('one'), workspace('two')]
    render(<ReferenceProjectsChip {...props({ references: ['/projects/one'], limit: 2 }, seats)} />)
    openMenu()
    expect(isChecked(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'one' }))).toBe(true)
    expect(isChecked(screen.getByRole('menuitem', { name: 'two' }))).toBe(false)
    expect(screen.queryByRole('menuitem', { name: 'own' })).toBeNull()
  })

  it('attaches on toggle by resubmitting the whole set', async () => {
    const setReferences = vi.fn(async () => OK)
    render(<ReferenceProjectsChip {...props({ references: [], limit: 2 }, [workspace('own', [SESSION]), workspace('one'), workspace('two')], setReferences)} />)
    openMenu()
    await act(async () => { fireEvent.click(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'one' })) })
    expect(setReferences).toHaveBeenCalledWith([wid('one')])
  })

  it('detaches on toggle by resubmitting the rest', async () => {
    const setReferences = vi.fn(async () => OK)
    const seats = [workspace('own', [SESSION]), workspace('one'), workspace('two')]
    render(<ReferenceProjectsChip {...props({ references: ['/projects/one', '/projects/two'], limit: 2 }, seats, setReferences)} />)
    openMenu()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'two' })) })
    expect(setReferences).toHaveBeenCalledWith([wid('one')])
  })

  it('renders deleted references as checked stale rows, and detaching one resubmits the live set', async () => {
    const setReferences = vi.fn(async () => OK)
    const seats = [workspace('own', [SESSION]), workspace('one')]
    render(<ReferenceProjectsChip {...props({ references: ['/projects/one', '/gone/path', '/'], limit: 2 }, seats, setReferences)} />)
    openMenu()
    expect(isChecked(screen.getByRole('menuitem', { name: 'path（已删除）' }))).toBe(true)
    expect(screen.getByRole('menuitem', { name: '/（已删除）' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'path（已删除）' })) })
    expect(setReferences).toHaveBeenCalledWith([wid('one')])
  })

  it('blocks additions at the projection limit while detaching stays live', async () => {
    const setReferences = vi.fn(async () => OK)
    const seats = [workspace('own', [SESSION]), workspace('one'), workspace('two'), workspace('three')]
    render(<ReferenceProjectsChip {...props({ references: ['/projects/one', '/projects/two'], limit: 2 }, seats, setReferences)} />)
    openMenu()
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'three' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'one' }).disabled).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'one' })) })
    expect(setReferences).toHaveBeenCalledWith([wid('two')])
  })

  it('warns when the host rejects the update', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rejected: RpcResult<{ accepted: true }> = { ok: false, error: { code: 'internal', message: 'no', details: {} } }
    const setReferences = vi.fn(async () => rejected)
    render(<ReferenceProjectsChip {...props({ references: [], limit: 2 }, [workspace('own', [SESSION]), workspace('one')], setReferences)} />)
    openMenu()
    await act(async () => { fireEvent.click(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'one' })) })
    expect(warn).toHaveBeenCalledWith('reference update rejected:', rejected.error)
    warn.mockRestore()
  })
})
