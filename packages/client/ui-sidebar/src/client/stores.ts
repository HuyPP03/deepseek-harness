/**
 * The sidebar shell's viewing store: the active browsing tab, persisted
 * across reloads. Module level exports the factory only (a module-level
 * handle would pin the store identity across plugin reloads); register()
 * receives the factory and the shell derives its PropsStore share from the
 * return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** The sidebar browsing tabs: the ungrouped chat rows, or the workspace tree. */
export type SidebarTab = 'chats' | 'workspaces'

/** Sidebar shell viewing state persisted across surface remounts and reloads. */
type SidebarViewState = {
  tab: SidebarTab
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type SidebarViewActions = {
  setTab: (draft: SidebarViewState, tab: SidebarTab) => void
}

/**
 * Create the sidebar shell viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createSidebarStore(): EngineStoreHandle<SidebarViewState, SidebarViewActions> {
  return defineStore({
    init: (): SidebarViewState => ({ tab: 'chats' }),
    persist: 'dsh.sidebar.view.v1',
    actions: {
      setTab: (d, tab: SidebarTab) => { d.tab = tab },
    },
  })
}
