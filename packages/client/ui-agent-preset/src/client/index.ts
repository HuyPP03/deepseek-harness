/**
 * Agent-preset surface plugin, browser half — five surfaces over one roster:
 * a General-settings row for the default preset, a chip on the new-session
 * screen for the session about to start, a read-only label in the session
 * header, a settings section that manages the roster (copy, delete,
 * default, and the way into a preset's own files), and the /mode DECORATION
 * — the host preset switch's bare invocation becomes a roster popup that
 * submits a completed `/mode <preset>` line through the host command.
 *
 * A running session keeps the composition it began with (the host refuses to
 * adopt an existing session under a different preset). That is what splits
 * the choice from the display: the General row and the hero chip are both
 * before-the-fact, while the header only reports what a session already runs.
 *
 * Every roster surface here renders names and descriptions through
 * {@link presetDisplayText}, so the shipped presets read in the active Web
 * locale rather than in whatever language their metadata files were written.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the command surface contract (the /mode decoration face).
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CHAT_PRESET_ID, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { AgentPresetLabel } from './AgentPresetLabel.tsx'
import type { AgentPresetLabelInjected } from './AgentPresetLabel.tsx'
import { AgentPresetRow } from './AgentPresetRow.tsx'
import type { AgentPresetRowInjected } from './AgentPresetRow.tsx'
import { AgentPresetSeat } from './AgentPresetSeat.tsx'
import type { AgentPresetSeatInjected } from './AgentPresetSeat.tsx'
import { AgentPresetSection } from './AgentPresetSection.tsx'
import type { AgentPresetSectionInjected } from './AgentPresetSection.tsx'
import { AgentPresetSeatController } from './seat-store.ts'
import type { SeatSessionSummary } from './seat-store.ts'
import { AgentPresetSectionController } from './section-store.ts'
import { en, presetDisplayText, zh } from './locales.ts'
import { AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController } from './settings-store.ts'

export type { AgentPresetLabelInjected, AgentPresetLabelProps } from './AgentPresetLabel.tsx'
export type { AgentPresetRowInjected, AgentPresetRowProps } from './AgentPresetRow.tsx'
export type { AgentPresetSeatInjected, AgentPresetSeatProps } from './AgentPresetSeat.tsx'
export type { AgentPresetSectionInjected, AgentPresetSectionProps } from './AgentPresetSection.tsx'
export type { AgentPresetSeatState, SeatSessionSummary } from './seat-store.ts'
export {
  draftBlocker, type AgentPresetSectionState, type CopyDraft, type PresetRow, type PresetView,
} from './section-store.ts'
export type { AgentPresetOption, AgentPresetSettingsState } from './settings-store.ts'
export { AGENT_PRESET_SETTINGS_NS, writeDefaultPreset } from './settings-store.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Mount the General-settings row.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const controller = new AgentPresetSettingsController(api)
  // One roster, four surfaces. The chip is registered in a later scope, so it
  // subscribes here rather than being reached from this one.
  const rosterReaders = new Set<() => void>()
  const section = new AgentPresetSectionController(api, () => {
    void controller.load()
    for (const read of rosterReaders) read()
  })

  ctx.effect(() => ctx.locale.register('settings.agentPreset', { zh, en }), 'ui-agent-preset: settings row dictionaries')

  const injected = (): AgentPresetRowInjected => ({
    hooks: { agentPreset: controller.store },
    load: () => controller.load(),
    select: (id: string) => controller.select(id),
  })

  ctx.effect(() => {
    // The roster is a live directory and the default is a settings field, so
    // both an external settings edit and a reconnect can move this row.
    const refresh = (): void => {
      void controller.load()
      // The section reads the same roster and marks the same default, so a
      // change made from either surface converges both.
      if (section.store.getSnapshot().status !== 'idle') void section.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        refresh()
      }),
      ctx.on('connection/reset', () => { refresh() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-agent-preset: settings refresh')

  // The settings section's conversational authoring entry: stage the
  // self-referential preset and land a new session on it. Bound inside the
  // conversation scope below (the seat and the session flow live there) and
  // unbound with it, so the section's face reads the current binding per
  // render and simply hides the button while no flow exists.
  let creatorDraft: (() => void) | undefined

  // The new-session chip and the header label: one controller, because the
  // staged choice belongs to the flow rather than to any one session.
  ctx.inject(['slots', 'conversation', 'sessions', 'workspaces'], (scope: ClientContext) => {
    const api = (scope.get('connection') as ConnectionHandle).api
    const seat = new AgentPresetSeatController(api, (): SeatSessionSummary | undefined => {
      const state = scope.sessions.list.getSnapshot()
      const summary = state.current === undefined ? undefined : state.byId[state.current]
      return summary === undefined
        ? undefined
        : {
          id: summary.id,
          blank: summary.blank,
          ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
        }
    }, (sessionId, agentPreset) => {
      scope.sessions.noteAgentPreset(sessionId as never, agentPreset)
    })

    const seatInjected = (): AgentPresetSeatInjected => ({
      hooks: { agentPresetSeat: seat.store },
      load: () => seat.load(),
      select: (id: string) => seat.select(id),
      introduced: () => { seat.introduced() },
    })

    const labelInjected = (): AgentPresetLabelInjected => ({
      hooks: { agentPresets: controller.store },
      load: () => controller.load(),
    })

    scope.effect(() => {
      // Connecting a workspace either creates a blank session or reuses one,
      // and either way the chip's pick predates it — so the stage is applied
      // when the session arrives, not when it was made.
      const stop = scope.sessions.list.subscribe(() => { void seat.apply() })
      // The chip opens on the deployment default, so a default changed from
      // the settings surface moves it too — otherwise the screen that starts
      // the next session keeps offering the previous default until a reload,
      // which is exactly the session the setting claims to govern. A staged
      // pick survives: `load()` prefers it over the refreshed fallback.
      const settingsMoved = scope.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        void seat.load()
      })
      // Every tab folds the committed preset into the shared session row; the
      // initiating tab may already have applied the RPC echo, which is idempotent.
      const presetSelected = scope.remote.$on('agent-preset/selected', (sessionId, agentPreset) => {
        scope.sessions.noteAgentPreset(sessionId, agentPreset)
      })
      // Authoring writes a FILE, not a setting, so nothing on the wire
      // announces it — without this the screen that starts the next session
      // keeps offering the roster as it stood when the chip first loaded, and
      // a preset authored to be used is missing from the one place it is used.
      const readRoster = (): void => { void seat.load() }
      rosterReaders.add(readRoster)
      // Stage WITHOUT applying — the still-current running session would
      // refuse the swap and drop the stage — then start the session it lands
      // on: the chip's list-change applier composes the blank session the
      // workspace connect produces or reuses.
      creatorDraft = () => {
        // The introduce cue makes the chip announce the pick the user never
        // made on this screen — the stage happened back in settings.
        seat.stage('cordis', true)
        scope.workspaces.startSession()
      }
      const chip = scope.slots.register({
        name: 'conversation.hero.agentPreset',
        locale: 'settings.agentPreset',
        inject: seatInjected,
      }, AgentPresetSeat)
      const label = scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'agent-preset',
        // Static session context occupies the header's leading negative-order band.
        order: -10,
        locale: 'settings.agentPreset',
        inject: labelInjected,
      }, AgentPresetLabel)
      return () => {
        stop()
        settingsMoved()
        presetSelected()
        rosterReaders.delete(readRoster)
        creatorDraft = undefined
        chip()
        label()
      }
    }, 'ui-agent-preset: new-session chip and header label')
  })

  const sectionInjected = (): AgentPresetSectionInjected => ({
    hooks: { agentPresetSection: section.store },
    load: () => section.load(),
    view: (id: string) => section.view(id),
    closeView: () => { section.closeView() },
    beginCopy: (from: string) => { section.beginCopy(from) },
    cancelCopy: () => { section.cancelCopy() },
    setCopyId: (id: string) => { section.setCopyId(id) },
    setCopyName: (name: string) => { section.setCopyName(name) },
    confirmCopy: () => section.confirmCopy(),
    openLocation: (id: string) => section.openLocation(id),
    ...creatorDraft === undefined ? {} : { startCreatorDraft: creatorDraft },
    confirmDelete: (id: string | null) => { section.confirmDelete(id) },
    remove: () => section.remove(),
    makeDefault: (id: string) => section.makeDefault(id),
  })

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'agent-preset',
    order: -25,
    locale: 'settings.agentPreset',
    inject: injected,
  }, AgentPresetRow))
  // Ordered after Models: choosing a model is routine, and composing an
  // agent is the deployment-shaping act behind it.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-presets',
    order: 20,
    label: () => ctx.locale.bind('settings.agentPreset')('nav'),
    locale: 'settings.agentPreset',
    inject: sectionInjected,
  }, AgentPresetSection))

  // The /mode decoration: a bare /mode pick opens the preset roster. The
  // roster read filters broken presets the same way the pickers do (a
  // broken preset cannot recompose a session), rows render through
  // presetDisplayText so shipped presets read in the active Web locale, and
  // the pick submits the completed line through the host command — not the
  // agentPreset.select RPC, which is blank-only (the composer seat's flow) —
  // so the command service's own admission path keeps the `command/executed`
  // observers (the log export's /export trigger) pointed at one submit
  // channel. The host command keeps its catalog row, argument claim, and
  // lifecycle logging, and owns the idle guard, the chat guard, and the
  // `agent-preset/selected` record.
  ctx.inject(['commandUi', 'sessions', 'remote.commands'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const t = ctx.locale.bind('settings.agentPreset')
    scope.effect(() => command.decorate({
      name: 'mode',
      available: (session) => {
        const preset = scope.sessions.list.getSnapshot().byId[session.sessionId]?.agentPreset
        // A chat session is fixed read-only: the host refuses the switch in
        // both directions, so the popup has nothing to offer.
        return preset !== CHAT_PRESET_ID
      },
      ui: {
        kind: 'popupSelect',
        options: async (session, signal) => {
          const connection = scope.get('connection') as ConnectionHandle
          const response = await connection.api.agentPresets.list({}, signal)
          if (!response.result.ok) {
            throw new Error(`agentPreset.list failed: ${response.result.error.code}: ${response.result.error.message}`)
          }
          const current = scope.sessions.list.getSnapshot().byId[session.sessionId]?.agentPreset
          return response.result.value.presets
            .filter(preset => preset.broken === undefined)
            .map((preset) => {
              const text = presetDisplayText(preset, t)
              return {
                id: preset.id,
                label: text.name,
                ...(text.description === undefined ? {} : { detail: text.description }),
                ...(preset.id === current ? { active: true } : {}),
              }
            })
        },
        onSelect: async (option, session) => {
          const result = await scope.remote.commands.execute(session.sessionId, `/mode ${option.id}`)
          if (!result.ok) throw new Error(`command.execute failed: ${result.error.code}: ${result.error.message}`)
        },
      },
    }), 'ui-agent-preset: /mode decoration')
  })
}
