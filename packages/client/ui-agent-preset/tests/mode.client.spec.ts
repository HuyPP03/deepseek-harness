// @vitest-environment jsdom
/**
 * The /mode decoration: a bare /mode pick opens the agent-preset roster as a
 * popup whose rows render through the locale-aware display copy — the shipped
 * presets read in the active Web locale, never the raw metadata language the
 * preset.yml files carry — with the session's current preset marked, broken
 * presets omitted, and a pick that submits a completed `/mode <preset>` line
 * through the commands Remote (the host command owns the guards and the
 * recomposition). The registration folds up on fiber disposal.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { CHAT_PRESET_ID } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandDecoration, CommandPopupSelectSpec } from '@deepseek-ai/dsh-client-ui-commands/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-agent-preset/client'

// These specs assert the shipped English copy; state the browser they assume.
usePinnedBrowserLanguages('en-US')

const sid = (key: string): SessionId => key as SessionId

interface ModeOption {
  id: string
  label: string
  detail?: string
  active?: boolean
}

interface RosterEntry {
  id: string
  trust: 'system' | 'user'
  isDefault?: boolean
  name?: string
  description?: string
  broken?: string
}

const ROSTER: RosterEntry[] = [
  // The shipped metadata is Chinese on disk; the popup must not show it.
  { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '功能完整的编码 Agent。' },
  { id: 'code', trust: 'system', name: 'PTC 模式', description: '通过 Code Mode SDK 呈现工具。' },
  { id: 'deployment-extra', trust: 'system', name: 'Extra mode' },
  { id: 'mine', trust: 'user', name: '我的模式', description: 'My custom preset' },
  { id: 'bare', trust: 'user' },
  { id: 'broken', trust: 'user', broken: 'composition failed' },
]

async function bench(opts: { listError?: string; executeError?: string } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listCalls: Array<{ payload: unknown; signal: AbortSignal | undefined }> = []
  const executeCalls: Array<{ sessionId: SessionId; line: string }> = []
  const commandsRemote = {
    execute: async (sessionId: SessionId, line: string) => {
      executeCalls.push({ sessionId, line })
      if (opts.executeError !== undefined) {
        return { ok: false as const, error: { code: 'internal', message: opts.executeError } }
      }
      return { ok: true as const, value: { matched: true, result: { kind: 'success' as const } } }
    },
  }
  const forwarded = new Map<string, Array<(...args: never[]) => void>>()
  ctx.provide('remote', {
    commands: commandsRemote,
    $on: (event: string, listener: (...args: never[]) => void) => {
      const listeners = forwarded.get(event) ?? []
      listeners.push(listener)
      forwarded.set(event, listeners)
      return () => { forwarded.set(event, listeners.filter(entry => entry !== listener)) }
    },
    $dispatch: (event: string, args: readonly unknown[]) => {
      for (const listener of forwarded.get(event) ?? []) listener(...args as never[])
    },
  })
  ctx.provide('remote.commands', commandsRemote)
  // The session list the availability check and the active marking read.
  const byId: Record<string, { id: string; blank: boolean; agentPreset?: string }> = {}
  const current: { id?: string } = {}
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ current: current.id, byId }),
      subscribe: () => () => undefined,
    },
  } as never)
  const decorated: CommandDecoration[] = []
  ctx.provide('commandUi', {
    register() { throw new Error('ui-agent-preset registers no client contributions') },
    decorate(decoration: CommandDecoration) {
      decorated.push(decoration)
      return () => {
        const at = decorated.indexOf(decoration)
        if (at >= 0) decorated.splice(at, 1)
      }
    },
  })
  const connection = {
    api: {
      agentPresets: {
        list: async (payload: unknown, signal?: AbortSignal) => {
          listCalls.push({ payload, signal })
          if (opts.listError !== undefined) {
            return { rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message: opts.listError } } }
          }
          return { rpcId: 'r', result: { ok: true as const, value: { presets: ROSTER, authorable: false, hasDocument: false } } }
        },
        read: async () => ({ rpcId: 'r', result: { ok: true as const, value: { agentPreset: 'standard', trust: 'system', content: '' } } }),
        copy: async () => ({ rpcId: 'r', result: { ok: true as const, value: { agentPreset: 'x' } } }),
        openDocument: async () => ({ rpcId: 'r', result: { ok: true as const, value: { opened: true as const } } }),
        remove: async () => ({ rpcId: 'r', result: { ok: true as const, value: {} } }),
        select: async (payload: { agentPreset: string }) => ({ rpcId: 'r', result: { ok: true as const, value: { agentPreset: payload.agentPreset } } }),
      },
      settings: {
        describe: async () => ({ rpcId: 'r', result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } } }),
        update: async () => ({ rpcId: 'r', result: { ok: true as const, value: {} } }),
      },
    },
  }
  ctx.provide('connection', connection as never)
  const fiber = ctx.plugin({ inject: [...inject, 'commandUi', 'sessions', 'remote.commands'], apply })
  await fiber.await()
  return {
    fiber, decorated, listCalls, executeCalls,
    addSession: (id: string, agentPreset?: string) => {
      current.id = id
      byId[id] = { id, blank: false, ...(agentPreset === undefined ? {} : { agentPreset }) }
    },
    setSessionPreset: (id: string, agentPreset?: string) => {
      byId[id] = { id, blank: false, ...(agentPreset === undefined ? {} : { agentPreset }) }
    },
  }
}

const projection = (id: string): { sessionId: SessionId } => ({ sessionId: sid(id) })

/** The decorated host /mode command, asserted to be a popupSelect. */
function modeEntry(decorated: CommandDecoration[]): {
  available: (session: { sessionId: SessionId }) => boolean
  options: (session: { sessionId: SessionId }, signal: AbortSignal) => Promise<readonly ModeOption[]>
  onSelect: (option: { id: string; label: string }, session: { sessionId: SessionId }) => void | Promise<void>
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

describe('ui-agent-preset /mode decoration', () => {
  it('registers the /mode decoration on the host command', async () => {
    const env = await bench()
    try {
      expect(env.decorated.map(entry => entry.name)).toEqual(['mode'])
      modeEntry(env.decorated)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('is offered everywhere except a chat session', async () => {
    const env = await bench()
    try {
      const mode = modeEntry(env.decorated)
      env.addSession('live', 'standard')
      expect(mode.available(projection('live'))).toBe(true)
      env.setSessionPreset('chat', CHAT_PRESET_ID)
      expect(mode.available(projection('chat'))).toBe(false)
      // A session the list no longer reports is not a chat session.
      expect(mode.available(projection('gone'))).toBe(true)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('lists healthy rows in the active locale, current preset active, broken preset omitted', async () => {
    const env = await bench()
    try {
      const mode = modeEntry(env.decorated)
      env.addSession('live', 'standard')
      const options = await mode.options(projection('live'), new AbortController().signal)
      // The shipped presets carry Chinese metadata on disk; the popup reads
      // them in the active Web locale. A user preset keeps its file text.
      expect(options).toEqual([
        { id: 'standard', label: 'Standard mode', detail: 'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.', active: true },
        { id: 'code', label: 'PTC mode', detail: 'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.' },
        // A system preset outside the shipped roster keeps its file copy; no
        // description means no detail row.
        { id: 'deployment-extra', label: 'Extra mode' },
        { id: 'mine', label: '我的模式', detail: 'My custom preset' },
        { id: 'bare', label: 'bare' },
      ])
      expect(env.listCalls).toHaveLength(1)
      expect(env.listCalls[0]!.payload).toEqual({})
      expect(env.listCalls[0]!.signal).toBeTypeOf('object')
    } finally {
      await env.fiber.dispose()
    }
  })

  it('a roster read failure rejects the options fetch', async () => {
    const env = await bench({ listError: 'presets refused' })
    try {
      const mode = modeEntry(env.decorated)
      env.addSession('live', 'standard')
      await expect(mode.options(projection('live'), new AbortController().signal))
        .rejects.toThrow('presets refused')
    } finally {
      await env.fiber.dispose()
    }
  })

  it('a pick submits the completed line through the commands Remote', async () => {
    const env = await bench()
    try {
      const mode = modeEntry(env.decorated)
      env.addSession('live', 'standard')
      await mode.onSelect({ id: 'code', label: 'PTC mode' }, projection('live'))
      expect(env.executeCalls).toEqual([{ sessionId: sid('live'), line: '/mode code' }])
      // The switch itself is the host command's job; the client touches no other wire.
      expect(env.listCalls).toHaveLength(0)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('a refused submission rejects the pick settle', async () => {
    const env = await bench({ executeError: 'agent is running' })
    try {
      const mode = modeEntry(env.decorated)
      env.addSession('live', 'standard')
      await expect(mode.onSelect({ id: 'code', label: 'PTC mode' }, projection('live')))
        .rejects.toThrow('agent is running')
      expect(env.executeCalls).toEqual([{ sessionId: sid('live'), line: '/mode code' }])
    } finally {
      await env.fiber.dispose()
    }
  })

  it('folds the decoration up on fiber disposal (HMR safety)', async () => {
    const env = await bench()
    expect(env.decorated).toHaveLength(1)
    await env.fiber.dispose()
    expect(env.decorated).toHaveLength(0)
  })
})
