/**
 * Workspace pick/add flow. WorkspacePickFlow is the reusable core (menu +
 * path error dialog) consumed directly by WorkspaceBrowser (same package) and
 * wrapped by WorkspacePicker for the conversation empty-state slot
 * registration. Directory picking itself lives in the composed flow package's
 * slot occupant (see the contract module doc): this core only opens the flow,
 * adopts the picked path, and owns the error surface. Adding a workspace has
 * exactly one route — pick a host directory, new or existing — because the
 * occupant's own create-folder affordance already covers creating one.
 *
 * Two confirmation modes: the single/add flow resolves on a row pick or an
 * adopted directory (onPick); the multi-select New-Session flow (the hero)
 * offers a plain-chat row plus checkable project rows — the first checked is
 * the session's main project, the rest attach as read-only references — and
 * resolves on the Start row (or null when the popover closes unconfirmed).
 */
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconFolderClose16, IconNewChatOutline16, IconPlusOutline16, Menu, Modal, Pill, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from './contract/slots.ts'
import css from './WorkspacePicker.module.css'

const ADD_WORKSPACE = '::add-workspace'
const PLAIN_CHAT = '::plain-chat'
const START = '::start'
/** 1 main project + 2 references — mirrors the host's session wire cap. */
const MAX_SESSION_WORKSPACES = 3

/** Shared flow props: popover control, workspace feed, add flow, error surface. */
interface PickFlowBaseProps {
  /** The standard locale seat, forwarded by whichever slot entry hosts the flow. */
  t: WorkspacePickerProps['t']
  /** Popover visibility (anchor button toggle state, owner-local). */
  open: boolean
  /** The anchor button element — the popover's placement anchor. */
  anchorRef?: RefObject<HTMLElement | null> | undefined
  /** Selector hook over the workspace list (framework standard hook). */
  useWorkspaces: <S>(selector: (state: WorkspaceListState) => S) => S
  /** Adopt a picked host directory as a real Workspace. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  /** Bound occupancy selector hook for this surface's directory-flow hole (empty leaves the surface with no add action). */
  useDirectoryFlow: SnapshotSelectorHook<boolean>
  /** Render this surface's directory-flow hole with the owner conversation (the entry's narrowed renderSlot). */
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => ReactNode
  /** Close the popover (outside click / Escape / post-pick / post-confirm). */
  onClose: () => void
  /** Only offer the add action, hide existing workspaces. */
  addOnly?: boolean
  /** Menu opening direction relative to the anchor. */
  side?: 'bottom' | 'top' | 'right'
  /** Currently active workspace (seeds the initial main pick in multi mode). */
  selectedId?: WorkspaceId | undefined
}

/** Single/add flow: a row pick or an adopted directory resolves it. */
export interface PickFlowSingleProps extends PickFlowBaseProps {
  multi?: false | undefined
  /** A real Workspace was picked or created. */
  onPick: (workspaceId: WorkspaceId) => void
}

/** Multi-select New-Session flow: the menu confirms a project selection. */
export interface PickFlowMultiProps extends PickFlowBaseProps {
  multi: true
  /** Confirmed selection (empty = plain chat); null when the popover closes unconfirmed. */
  onConfirm: (selection: { main?: WorkspaceId | undefined; references: WorkspaceId[] } | null) => void
}

export type WorkspacePickFlowProps = PickFlowSingleProps | PickFlowMultiProps

/**
 * Render the pick menu plus the adoption error dialog.
 * @param props - owner-controlled flow props (single or multi mode).
 * @returns menu + dialog elements.
 */
export function WorkspacePickFlow(props: WorkspacePickFlowProps) {
  const {
    t,
    open,
    anchorRef,
    useWorkspaces,
    createWorkspace,
    useDirectoryFlow,
    renderDirectoryFlow,
    onClose,
    addOnly = false,
    side = 'bottom',
    selectedId,
  } = props
  const multi = props.multi === true
  const getAnchorRect = useCallback(
    () => anchorRef?.current?.getBoundingClientRect() ?? null,
    [anchorRef],
  )
  const [errorOpen, setErrorOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  /** Checked project ids in selection order (first = main) — multi mode only. */
  const [selected, setSelected] = useState<WorkspaceId[]>([])
  // One picking interaction at a time: while the flow is open (native chooser
  // pending, browse dialog up) or its pick is being adopted, every other
  // menu action stays disabled — a late outcome must not race a concurrent
  // selection or adoption.
  const flowBusy = flowOpen || pickingFolder

  const workspaceSnapshot = useWorkspaces(state => state)
  const workspaces = workspaceSnapshot.items

  // The occupied hole gates the picking affordance: with no composed flow the
  // entry simply is not there (the seam's documented no-flow default). The
  // framework-bound hook keeps occupancy live: flow plugins activate (and
  // HMR-reload) independently of this menu's renders.
  const flowAvailable = useDirectoryFlow(occupied => occupied)
  // An occupant that unloads mid-interaction leaves nobody to cancel: an
  // open flow over an empty hole withdraws so the menu actions come back.
  // flowOpen is a dependency because the flow can also OPEN over an already
  // empty hole (Choose again after the occupant unloaded with the error
  // dialog up) — that transition must snap back too, not just occupancy loss.
  useEffect(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false)
  }, [flowOpen, flowAvailable])

  // Multi mode re-seeds its checks on every open: the owner's selectedId is
  // the only durable preselection (the current session's workspace). A
  // cancelled selection must not survive into the next open, and a seeded
  // pick waits for a list that can still prove the workspace exists.
  const seededOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      seededOpen.current = false
      setSelected([])
      return
    }
    if (!multi || seededOpen.current) return
    if (selectedId !== undefined && !workspaces.some(workspace => workspace.workspaceId === selectedId)) return
    setSelected(selectedId === undefined ? [] : [selectedId])
    seededOpen.current = true
  }, [open, multi, selectedId, workspaces])

  const addEntries: MenuEntry[] = flowAvailable
    ? [{ id: ADD_WORKSPACE, label: t('menu.addWorkspace'), icon: <IconPlusOutline16 size={16} />, disabled: flowBusy }]
    : []
  // With workspaces listed, the add action pins below the scroll region
  // (divider + always visible); otherwise it IS the menu.
  const pinAdd = !addOnly && workspaces.length > 0
  const mainId = selected[0]
  const atCapacity = selected.length >= MAX_SESSION_WORKSPACES

  let items: MenuEntry[]
  let footer: MenuEntry[] | undefined
  if (addOnly) {
    items = addEntries
    footer = undefined
  } else if (multi) {
    // Plain chat is a real row (an empty check set), not an absent menu:
    // with no projects at all the menu still offers it plus the add action.
    const workspaceRows: MenuEntry[] = workspaces.map(workspace => ({
      id: workspace.workspaceId,
      label: (
        <span className={css.rowLabel}>
          {workspace.title}
          {mainId === workspace.workspaceId && <Pill className={css.mainBadge}>{t('menu.mainBadge')}</Pill>}
        </span>
      ),
      icon: <IconFolderClose16 size={16} />,
      // The capacity cap (1 main + 2 references) blocks additions only;
      // unchecking stays live so a capped set can be re-ordered.
      disabled: flowBusy || (!selected.includes(workspace.workspaceId) && atCapacity),
    }))
    // With no list the add row lives in the body (nothing to pin below);
    // with a list it stays pinned so the Start row is always the last one.
    items = [
      { id: PLAIN_CHAT, label: t('menu.noProject'), icon: <IconNewChatOutline16 size={16} />, disabled: flowBusy },
      ...workspaceRows,
      ...(pinAdd ? [] : addEntries),
    ]
    footer = [...(pinAdd ? addEntries : []), { id: START, label: t('menu.start'), disabled: flowBusy }]
  } else {
    items = pinAdd
      ? workspaces.map(workspace => ({
        id: workspace.workspaceId,
        label: workspace.title,
        icon: <IconFolderClose16 size={16} />,
        disabled: flowBusy,
      }))
      : addEntries
    footer = pinAdd ? addEntries : undefined
  }
  // Multi mode never renders an empty menu (the plain-chat row always is).
  const menuIsEmpty = !multi && items.length === 0

  const closeModal = (): void => {
    setErrorOpen(false)
    setModalError(null)
  }

  /** Adopt a picked directory; failures land in the folder-error dialog (Choose again reopens the flow). */
  const adoptDirectory = (path: string): Promise<void> =>
    createWorkspace({ path }).then((workspace) => {
      setFlowOpen(false)
      if (multi) {
        // Creation starts a session the same way a row pick would: the new
        // project is main and nothing else attaches.
        props.onConfirm({ main: workspace.workspaceId, references: [] })
        return
      }
      props.onPick(workspace.workspaceId)
    }).catch((reason: unknown) => {
      setModalError(reason instanceof Error ? reason.message : String(reason))
      setFlowOpen(false)
      setErrorOpen(true)
    })

  const openDirectoryFlow = useCallback((): void => {
    onClose()
    setErrorOpen(false)
    setModalError(null)
    setFlowOpen(true)
  }, [onClose])

  // A menu exists to disambiguate between targets. Single/add-only surfaces
  // with no workspaces listed and the add action the only entry left make the
  // anchor gesture BE that action: a one-row popover would cost a click and
  // offer nothing to choose between. The owner's open request is consumed the
  // same way selecting the entry would consume it (close the popover, raise
  // the flow). Multi mode never skips its menu — the plain-chat row makes
  // even a bare menu a real choice. An empty list is only final once the
  // baseline lands — until then the menu stays up with its loading status
  // instead of jumping into a flow the arriving list would have made
  // unnecessary; the add-only surface lists nothing and never waits.
  const listSettled = addOnly || workspaceSnapshot.phase === 'ready'
  const addIsTheOnlyEntry = !multi && !pinAdd && listSettled && addEntries.length === 1
  // `flowBusy` gates this exactly as it disables the equivalent menu entry: a
  // pick still being adopted owns the surface until it settles.
  useEffect(() => {
    if (open && addIsTheOnlyEntry && !flowBusy) openDirectoryFlow()
  }, [open, addIsTheOnlyEntry, flowBusy, openDirectoryFlow])

  /** Owner side of the flow conversation: adopt keeps the flow open (busy) until the Host answers. */
  const flowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy: pickingFolder,
    onPicked: (path) => {
      setPickingFolder(true)
      void adoptDirectory(path).finally(() => { setPickingFolder(false) })
    },
    onCancel: () => { setFlowOpen(false) },
    onError: (message) => {
      setFlowOpen(false)
      setModalError(message)
      setErrorOpen(true)
    },
  }

  const handleSelect = (id: string): void => {
    if (id === ADD_WORKSPACE) {
      openDirectoryFlow()
      return
    }
    if (multi) {
      if (id === PLAIN_CHAT) {
        setSelected([])
        return
      }
      if (id === START) {
        // Whole value: the first checked project is main, the rest attach as
        // references; an empty check set is the plain-chat selection.
        props.onConfirm(selected.length === 0
          ? { references: [] }
          : { main: selected[0], references: selected.slice(1) })
        return
      }
      const workspaceId = id as WorkspaceId
      setSelected(prev => prev.includes(workspaceId) ? prev.filter(id2 => id2 !== workspaceId) : [...prev, workspaceId])
      return
    }
    props.onPick(id as WorkspaceId)
  }

  return (
    <>
      <Menu
        open={open && !addIsTheOnlyEntry && !menuIsEmpty}
        anchor={null}
        items={items}
        {...(footer === undefined ? {} : { footer })}
        selectedId={multi ? undefined : selectedId}
        selectedIds={multi ? (selected.length === 0 ? [PLAIN_CHAT] : selected) : undefined}
        onSelect={handleSelect}
        onClose={onClose}
        side={side}
        portal
        getAnchorRect={getAnchorRect}
      />
      {open && !addIsTheOnlyEntry && !menuIsEmpty && workspaceSnapshot.phase === 'pending' && <div className={css.menuStatus} role="status">{t('picker.loading')}</div>}
      {renderDirectoryFlow(flowOwner)}
      <Modal
        open={errorOpen}
        onClose={closeModal}
        closeLabel={t('close')}
        title={t('folderError.title')}
        footer={(
          <>
            <Button variant="outline" className={css.modalAction} onClick={closeModal}>{t('cancel')}</Button>
            {/* Retrying needs an occupant to serve the flow; without one the
              * button would open a flow nobody can answer or cancel. */}
            <Button variant="primary" className={css.modalAction} disabled={!flowAvailable} onClick={openDirectoryFlow}>{t('folderError.retry')}</Button>
          </>
        )}
      >
        <div className={css.modalError} role="alert">{modalError}</div>
      </Modal>
    </>
  )
}

/**
 * The conversation empty-state registration: adapts the owner share to the
 * multi-select flow (all state and semantics live in the flow / the owner).
 * @param props - empty-state slot props (owner share + injected creation callback).
 * @returns the flow element.
 */
export function WorkspacePicker({
  open,
  anchorRef,
  useWorkspaces,
  selectedId,
  onConfirm,
  createWorkspace,
  useDirectoryFlow,
  renderSlot,
  t,
}: WorkspacePickerProps) {
  return (
    <WorkspacePickFlow
      t={t}
      open={open}
      anchorRef={anchorRef}
      useWorkspaces={useWorkspaces}
      createWorkspace={createWorkspace}
      useDirectoryFlow={useDirectoryFlow}
      renderDirectoryFlow={owner => renderSlot('conversation.hero.workspace.directoryFlow', owner)}
      selectedId={selectedId}
      multi
      onConfirm={onConfirm}
      // The owner share has no separate close channel: an unconfirmed close
      // and a cancel are the same event (selection null).
      onClose={() => onConfirm(null)}
    />
  )
}
