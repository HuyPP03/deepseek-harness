/**
 * Settings panel controller (`ctx.settingsPanel`): the open state and the
 * active section id of the settings panel, owned by a service so any client
 * plugin can open the panel on a specific section — not only the shell's own
 * trigger and the onboarding steps that sit inside it.
 *
 * The shell (SettingsRoot) renders from this store; the trigger, the nav,
 * and the close paths write through it, and a registration outside the
 * panel (a command popup row, a sidebar action) calls `openSection` to deep
 * link into one of its sections.
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The settings panel's viewing state. */
export interface SettingsPanelState {
  /** Whether the panel is open. */
  open: boolean
  /** The section id the panel shows; the shell falls back to the first row. */
  activeId: string | undefined
}

const INITIAL: SettingsPanelState = { open: false, activeId: undefined }

/**
 * The settings panel's open state and section selection.
 *
 * @param ctx - the owning root context (plugin fiber; the service registers
 * itself as `settingsPanel` and follows that fiber's lifetime).
 */
export class SettingsPanelController extends Service {
  /** The panel state; the shell renders from it, deep links write through it. */
  readonly store: SnapshotStore<SettingsPanelState> = createSnapshotStore(INITIAL)

  constructor(ctx: Context) {
    super(ctx, 'settingsPanel')
  }

  /**
   * Open the panel.
   * @param id - the section to show; absent keeps the current selection.
   */
  openSection(id?: string): void {
    const { activeId } = this.store.getSnapshot()
    this.store.set({ open: true, activeId: id ?? activeId })
  }

  /** Close the panel and drop the selection. */
  close(): void {
    this.store.set({ open: false, activeId: undefined })
  }

  /**
   * Select one section of the open panel.
   * @param id - the section id to show.
   */
  setActiveId(id: string): void {
    this.store.update((draft) => {
      draft.activeId = id
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settingsPanel: SettingsPanelController
  }
}
