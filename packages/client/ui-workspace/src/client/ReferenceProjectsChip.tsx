/**
 * In-session reference-project chip (session header action). Reads the
 * host-computed `workspaceReferences` projection — key absence means the
 * capability is uncomposed, and the chip hides — and toggles read-only
 * reference projects on the session through the whole-value
 * `session.setReferences` verb (every toggle resubmits the complete set;
 * the Host normalizes and logs one workspace/references event per change).
 * The menu lists every registered workspace except the session's own; an
 * attached reference whose path no longer matches a live workspace (deleted
 * registration) appears as a stale row that detaches on toggle. Sessions no
 * listed workspace owns (plain chat, unaccounted cwd) hide the chip.
 */
import { useEffect, useMemo, useState } from 'react'
import type { RpcResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  UseProjection, WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the root module carries the `workspaceReferences` projection
// key merge (the /types subpath does not).
import type {} from '@deepseek-ai/dsh-workspace-references'
import { IconFolderClose16, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ReferenceProjectsChip.module.css'

/** Whole-value reference-set mutation bound to the chip's session. */
export interface ReferenceProjectsChipInjected {
  /**
   * Replace the session's reference-project set whole-value.
   * @param referenceWorkspaceIds - the complete reference set after the change.
   * @returns the wire result.
   */
  setReferences: (referenceWorkspaceIds: readonly WorkspaceId[]) => Promise<RpcResult<{ accepted: true }>>
}

/** Full props for the session-header reference-project action. */
export type ReferenceProjectsChipProps =
  PropsRuntime<'conversation.session.header.actions'>
  & { useProjection: UseProjection }
  & ReferenceProjectsChipInjected
  & PropsLocale<'workspace'>

/** Stable prefix for the transient rows of references no live workspace serves. */
const STALE_PREFIX = '::stale:'

/** Basename of a canonical path (the last non-empty segment). */
function pathBasename(path: string): string {
  const segments = path.split('/').filter(segment => segment.length > 0)
  return segments[segments.length - 1] ?? path
}

/**
 * @param props - runtime slot currency, the projection seat, the bound
 *   setReferences callback, and the namespace translator.
 * @returns the trigger and its menu, or null when the session carries no
 *   workspace or the capability is uncomposed.
 */
export function ReferenceProjectsChip({
  sessionId, useWorkspaces, useProjection, setReferences, t,
}: ReferenceProjectsChipProps) {
  const view = useProjection('workspaceReferences')
  const workspaces = useWorkspaces(state => state.items)
  const [open, setOpen] = useState(false)

  // The owning workspace: membership in a listed workspace's sessionIds —
  // the same rule the hero chip resolves the session's project with.
  const own = workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
  const hidden = view === undefined || own === undefined

  // A capability frame can disappear under an open menu (host projection
  // reset): close it before the unmount steals focus.
  useEffect(() => {
    if (hidden && open) setOpen(false)
  }, [hidden, open])

  const derived = useMemo(() => {
    if (view === undefined || own === undefined) {
      return { referencedIds: [] as WorkspaceId[], rows: [] as MenuEntry[], selectedIds: [] as string[] }
    }
    const pathToId = new Map(workspaces.map(workspace => [workspace.path, workspace.workspaceId] as const))
    const referencedIds = view.references
      .map(path => pathToId.get(path))
      .filter((id): id is WorkspaceId => id !== undefined)
    const stalePaths = view.references.filter(path => pathToId.get(path) === undefined)
    const atCapacity = view.references.length >= view.limit
    const rows: MenuEntry[] = workspaces
      .filter(workspace => workspace.workspaceId !== own?.workspaceId)
      .map((workspace) => {
        const isReferenced = view.references.includes(workspace.path)
        return {
          id: workspace.workspaceId,
          label: workspace.title,
          icon: <IconFolderClose16 size={16} />,
          // The projection limit blocks additions only: detaching a
          // referenced project stays live so a full set can shrink.
          disabled: !isReferenced && atCapacity,
        }
      })
    for (const path of stalePaths) {
      rows.push({
        id: `${STALE_PREFIX}${path}`,
        label: `${pathBasename(path)}${t('chip.stale')}`,
        icon: <IconFolderClose16 size={16} />,
      })
    }
    const selectedIds = [
      ...referencedIds,
      ...stalePaths.map(path => `${STALE_PREFIX}${path}`),
    ]
    return { referencedIds, rows, selectedIds }
  }, [view, workspaces, own?.workspaceId, t])

  const count = view?.references.length ?? 0
  const label = count === 0 ? t('chip.add') : t(count === 1 ? 'chip.count.one' : 'chip.count.other', { count })

  if (hidden) return null

  /**
   * Whole-value toggle: detach (resubmit the rest) or attach (resubmit the
   * union), then close the menu — the count label shows the result, and a
   * still-open menu would swallow the chip's next click as its outside-click.
   */
  const toggle = (id: string): void => {
    setOpen(false)
    const referencedIds = derived.referencedIds
    let next: readonly WorkspaceId[]
    if (id.startsWith(STALE_PREFIX)) {
      next = referencedIds
    } else if (referencedIds.includes(id as WorkspaceId)) {
      next = referencedIds.filter(id2 => id2 !== id)
    } else {
      next = [...referencedIds, id as WorkspaceId]
    }
    void setReferences(next).then((result) => {
      if (!result.ok) console.warn('reference update rejected:', result.error)
    })
  }

  return (
    <Menu
      open={open}
      anchor={(
        <button
          type="button"
          className={css.trigger}
          aria-label={t('chip.aria')}
          aria-expanded={open}
          onClick={() => { setOpen(current => !current) }}
        >
          <IconFolderClose16 size={16} className={css.triggerIcon} />
          <span className={css.count}>{label}</span>
        </button>
      )}
      items={derived.rows}
      selectedIds={derived.selectedIds}
      onSelect={toggle}
      onClose={() => { setOpen(false) }}
      side="bottom"
    />
  )
}
