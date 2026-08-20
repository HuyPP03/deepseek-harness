// @vitest-environment jsdom
/**
 * ui-slash-tools browser half on a real cordis Context: the /clear ACTION
 * contribution registers with the command surface, is offered only on a
 * non-blank current session, mints a fresh session in the current session's
 * workspace (account membership) and preset, opens it, leaves a blank current
 * session untouched, and propagates a create failure so the command service's
 * log-only path owns it. The /help contribution lists the merged menu face
 * (host catalog + available contributions) as an informational popup. The
 * /mode decoration lists the healthy agent-preset roster with the session's
 * current preset marked, stays off chat sessions, and submits a completed
 * `/mode <preset>` line through the commands Remote (the host command owns
 * the guards and the recomposition). The registrations fold up on fiber
 * disposal.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { CHAT_PRESET_ID } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  CommandActionSpec, CommandContribution, CommandDecoration, CommandMenuRow, CommandPopupSelectSpec,
} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { TestSessions, TestWorkspaces, type Stabilizer } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'

const sid = (key: string): SessionId => key as SessionId
const wid = (key: string): WorkspaceId => key as WorkspaceId
const projection = (id: string): ClientSessionContext => ({ sessionId: sid(id) })

interface ModeOption {
  id: string
  label: string
  detail?: string
  active?: boolean
}

const MENU_ROWS: CommandMenuRow[] = [
  { name: 'mode', description: 'Switch this session agent preset (mode)' },
  { name: 'plan', description: 'Toggle plan mode' },
  { name: 'clear', description: 'Clear this conversation: start a fresh one in the same workspace' },
]

interface RosterEntry {
  id: string
  trust: 'system' | 'user'
  name?: string
  description?: string
  broken?: string
}

async function bench(opts: { roster?: RosterEntry[]; listError?: string; executeError?: string } = {}) {
  const ctx = new Context()
  const stabilize: Stabilizer = async (fn) => { await fn() }
  const sessions = new TestSessions(stabilize, ctx)
  const workspaces = new TestWorkspaces(stabilize)
  const registered: CommandContribution[] = []
  const decorated: CommandDecoration[] = []
  const menuRowsCalls: Array<ClientSessionContext> = []
  const listCalls: Array<{ payload: unknown; signal: AbortSignal | undefined }> = []
  const executeCalls: Array<{ sessionId: SessionId; line: string }> = []
  const roster = opts.roster ?? [
    { id: 'standard', trust: 'system', name: 'Standard', description: 'The shipped default' },
    { id: 'code', trust: 'system' },
    { id: 'broken', trust: 'user', broken: 'composition failed' },
  ]
  async function executeRemote(sessionId: SessionId, line: string) {
    executeCalls.push({ sessionId, line })
    if (opts.executeError !== undefined) {
      return { ok: false as const, error: { code: 'internal', message: opts.executeError } }
    }
    return { ok: true as const, value: { matched: true, result: { kind: 'success' as const } } }
  }
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('commandUi', {
    register(contribution: CommandContribution) {
      registered.push(contribution)
      return () => {
        const at = registered.indexOf(contribution)
        if (at >= 0) registered.splice(at, 1)
      }
    },
    decorate(decoration: CommandDecoration) {
      decorated.push(decoration)
      return () => {
        const at = decorated.indexOf(decoration)
        if (at >= 0) decorated.splice(at, 1)
      }
    },
    menuRows: async (session: ClientSessionContext) => {
      menuRowsCalls.push(session)
      return MENU_ROWS
    },
    popupFor() { return {} },
  })
  ctx.provide('connection', {
    api: {
      agentPresets: {
        list: async (payload: unknown, signal?: AbortSignal) => {
          listCalls.push({ payload, signal })
          if (opts.listError !== undefined) {
            return { result: { ok: false as const, error: { code: 'internal', message: opts.listError } } }
          }
          return { result: { ok: true as const, value: { presets: roster, authorable: false, hasDocument: false } } }
        },
      },
    },
  })
  ctx.provide('sessions', sessions)
  ctx.provide('workspaces', workspaces)
  ctx.provide('remote', { commands: { execute: executeRemote } })
  ctx.provide('remote.commands', { execute: executeRemote })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { fiber, sessions, workspaces, registered, decorated, menuRowsCalls, listCalls, executeCalls }
}

/** The registered /clear contribution, asserted to be the action-kind entry. */
function clearEntry(registered: CommandContribution[]): { run: (session: ClientSessionContext) => void | Promise<void> } {
  const entry = registered.find(item => item.name === 'clear')
  expect(entry, 'the /clear contribution').toBeDefined()
  expect(entry!.description).toBe('Clear this conversation: start a fresh one in the same workspace')
  expect(entry!.ui.kind).toBe('action')
  const ui = entry!.ui as CommandActionSpec
  const run = ui.run.bind(ui)
  return { run }
}

/** The registered /help contribution, asserted to be a popupSelect. */
function helpEntry(registered: CommandContribution[]): {
  available: (session: ClientSessionContext) => boolean
  options: (session: ClientSessionContext, signal: AbortSignal) => Promise<readonly { id: string; label: string; detail?: string }[]>
  onSelect: (option: { id: string; label: string }, session: ClientSessionContext) => void | Promise<void>
} {
  const entry = registered.find(item => item.name === 'help')
  expect(entry, 'the /help contribution').toBeDefined()
  expect(entry!.description).toBe('List the slash commands available in this session')
  expect(entry!.ui.kind).toBe('popupSelect')
  const ui = entry!.ui as CommandPopupSelectSpec
  return {
    available: entry!.available.bind(entry!),
    options: ui.options.bind(ui),
    onSelect: ui.onSelect.bind(ui),
  }
}

/** The decorated host /mode command, asserted to be a popupSelect. */
function modeEntry(decorated: CommandDecoration[]): {
  available: (session: ClientSessionContext) => boolean
  options: (session: ClientSessionContext, signal: AbortSignal) => Promise<readonly ModeOption[]>
  onSelect: (option: { id: string; label: string }, session: ClientSessionContext) => void | Promise<void>
} {
  const entry = decorated.find(item => item.name === 'mode')
  expect(entry, 'the /mode decoration').toBeDefined()
  expect(entry!.ui.kind).toBe('popupSelect')
  const ui = entry!.ui as CommandPopupSelectSpec
  return {
    available: entry!.available.bind(entry!),
    options: ui.options.bind(ui),
    onSelect: ui.onSelect.bind(ui),
  }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['commandUi', 'locale', 'sessions', 'workspaces', 'connection', 'remote', 'remote.commands'])
  })

  it('registers /clear and /help contributions plus the /mode decoration', async () => {
    const env = await bench()
    try {
      expect(env.registered.map(entry => entry.name).sort()).toEqual(['clear', 'help'])
      expect(env.decorated.map(entry => entry.name)).toEqual(['mode'])
      clearEntry(env.registered)
      helpEntry(env.registered)
      modeEntry(env.decorated)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('offers /clear only on a non-blank, listed current session', async () => {
    const env = await bench()
    try {
      const clear = env.registered.find(entry => entry.name === 'clear')!
      const available = clear.available.bind(clear)
      await env.sessions.add({ id: 'live' })
      await env.sessions.add({ id: 'fresh', summary: { blank: true } }, { current: false })
      expect(available(projection('live'))).toBe(true)
      expect(available(projection('fresh'))).toBe(false)
      expect(available(projection('gone'))).toBe(false)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('mints a fresh session in the current workspace and preset, then opens it', async () => {
    const env = await bench()
    try {
      const current = await env.sessions.add({ id: 'live', summary: { agentPreset: 'standard' } })
      await env.workspaces.update((draft) => {
        draft.items = [{
          workspaceId: wid('w1'),
          path: '/tmp/w1',
          title: 'w1',
          sessionIds: [current],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }]
      })
      const { run } = clearEntry(env.registered)
      await run(projection('live'))
      expect(env.sessions.calls.map(call => call.method)).toEqual(['create', 'open'])
      expect(env.sessions.calls[0]!.args).toEqual([{ workspaceId: 'w1', agentPreset: 'standard' }])
      const created = env.sessions.list.getSnapshot().byId[sid('created-1')]
      expect(created).toBeDefined()
      expect(created?.blank).toBe(true)
      expect(created?.agentPreset).toBe('standard')
      expect(env.sessions.calls[1]!.args).toEqual(['created-1'])
      // The navigation landed on the new session; the old one stays listed.
      expect(env.sessions.list.getSnapshot().current).toBe('created-1')
      expect(env.sessions.list.getSnapshot().byId[sid('live')]).toBeDefined()
    } finally {
      await env.fiber.dispose()
    }
  })

  it('mints a bare session when the current one belongs to no workspace and names no preset', async () => {
    const env = await bench()
    try {
      const { run } = clearEntry(env.registered)
      await env.sessions.add({ id: 'chat' })
      await run(projection('chat'))
      expect(env.sessions.calls).toContainEqual({ method: 'create', args: [{}] })
      expect(env.sessions.calls).toContainEqual({ method: 'open', args: ['created-1'] })
    } finally {
      await env.fiber.dispose()
    }
  })

  it('re-checks blankness at run time and no-ops on a blank current session', async () => {
    const env = await bench()
    try {
      const { run } = clearEntry(env.registered)
      await env.sessions.add({ id: 'fresh', summary: { blank: true } })
      await run(projection('fresh'))
      expect(env.sessions.calls).toEqual([])
    } finally {
      await env.fiber.dispose()
    }
  })

  it('propagates a create failure so the command service logs it', async () => {
    const env = await bench()
    try {
      const { run } = clearEntry(env.registered)
      await env.sessions.add({ id: 's1' })
      ;(env.sessions as { create: () => Promise<SessionId> }).create = async () => {
        throw new Error('host refused the session')
      }
      await expect(run(projection('s1'))).rejects.toThrow('host refused the session')
      expect(env.sessions.calls).toEqual([])
    } finally {
      await env.fiber.dispose()
    }
  })

  it('/help is always available and lists the merged menu face as rows', async () => {
    const env = await bench()
    try {
      const help = helpEntry(env.registered)
      expect(help.available(projection('anything'))).toBe(true)
      await env.sessions.add({ id: 's1' })
      const options = await help.options(projection('s1'), new AbortController().signal)
      expect(options).toEqual([
        { id: 'mode', label: '/mode', detail: 'Switch this session agent preset (mode)' },
        { id: 'plan', label: '/plan', detail: 'Toggle plan mode' },
        { id: 'clear', label: '/clear', detail: 'Clear this conversation: start a fresh one in the same workspace' },
      ])
      expect(env.menuRowsCalls.map(call => call.sessionId)).toEqual(['s1'])
      // Informational listing: selecting a row settles without running it.
      await expect(help.onSelect({ id: 'plan', label: '/plan' }, projection('s1'))).resolves.toBeUndefined()
      expect(env.executeCalls).toEqual([])
    } finally {
      await env.fiber.dispose()
    }
  })

  it('/mode decoration: offered everywhere except a chat session', async () => {
    const env = await bench()
    try {
      const mode = modeEntry(env.decorated)
      await env.sessions.add({ id: 'live' })
      await env.sessions.add({ id: 'chat', summary: { agentPreset: CHAT_PRESET_ID } }, { current: false })
      expect(mode.available(projection('live'))).toBe(true)
      expect(mode.available(projection('chat'))).toBe(false)
      // A session the list no longer reports is not a chat session.
      expect(mode.available(projection('gone'))).toBe(true)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('/mode decoration: healthy roster rows, current preset active, broken preset omitted', async () => {
    const env = await bench()
    try {
      const mode = modeEntry(env.decorated)
      await env.sessions.add({ id: 'live', summary: { agentPreset: 'standard' } })
      const options = await mode.options(projection('live'), new AbortController().signal)
      // A preset that published no display name renders its id as the label.
      expect(options).toEqual([
        { id: 'standard', label: 'Standard', detail: 'The shipped default', active: true },
        { id: 'code', label: 'code' },
      ])
      expect(env.listCalls).toHaveLength(1)
      expect(env.listCalls[0]!.payload).toEqual({})
      expect(env.listCalls[0]!.signal).toBeTypeOf('object')
    } finally {
      await env.fiber.dispose()
    }
  })

  it('/mode decoration: a roster read failure rejects the options fetch', async () => {
    const env = await bench({ listError: 'presets refused' })
    try {
      const mode = modeEntry(env.decorated)
      await env.sessions.add({ id: 'live' })
      await expect(mode.options(projection('live'), new AbortController().signal))
        .rejects.toThrow('presets refused')
    } finally {
      await env.fiber.dispose()
    }
  })

  it('/mode decoration: a pick submits the completed line through the commands Remote', async () => {
    const env = await bench()
    try {
      const mode = modeEntry(env.decorated)
      await env.sessions.add({ id: 'live', summary: { agentPreset: 'standard' } })
      await mode.onSelect({ id: 'code', label: 'Code' }, projection('live'))
      expect(env.executeCalls).toEqual([{ sessionId: sid('live'), line: '/mode code' }])
      // The switch itself is the host command's job; the client touches no other wire.
      expect(env.listCalls).toHaveLength(0)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('/mode decoration: a refused submission rejects the pick settle', async () => {
    const env = await bench({ executeError: 'agent is running' })
    try {
      const mode = modeEntry(env.decorated)
      await env.sessions.add({ id: 'live', summary: { agentPreset: 'standard' } })
      await expect(mode.onSelect({ id: 'code', label: 'code' }, projection('live')))
        .rejects.toThrow('agent is running')
      expect(env.executeCalls).toEqual([{ sessionId: sid('live'), line: '/mode code' }])
    } finally {
      await env.fiber.dispose()
    }
  })

  it('folds all three registrations up on fiber disposal (HMR safety)', async () => {
    const env = await bench()
    expect(env.registered).toHaveLength(2)
    expect(env.decorated).toHaveLength(1)
    await env.fiber.dispose()
    expect(env.registered).toHaveLength(0)
    expect(env.decorated).toHaveLength(0)
  })
})
