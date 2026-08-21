// @vitest-environment jsdom
/**
 * The /mcp decoration: a bare /mcp pick opens the reported-server roster as a
 * popup whose rows carry the server's status and tool count and gate behind a
 * reconnect confirmation; the trailing row deep links into the MCP settings
 * section through the panel controller. A pick of a server row drives the
 * privileged reconnect call. The registration folds up on fiber disposal.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandDecoration, CommandPopupSelectSpec } from '@deepseek-ai/dsh-client-ui-commands/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'

// These specs assert the shipped English copy; state the browser they assume.
usePinnedBrowserLanguages('en-US')

const session: ClientSessionContext = { sessionId: 'live' as never }

/** One reported server row for the roster fakes. */
const SERVERS = [
  {
    serverName: 'websift',
    status: 'connected' as const,
    managed: false,
    tools: [
      { name: 'mcp__websift__web_search', description: 'Search the web' },
      { name: 'mcp__websift__web_fetch', description: 'Fetch a page' },
    ],
  },
  {
    serverName: 'github',
    status: 'reconnecting' as const,
    managed: true,
    tools: [],
  },
  {
    serverName: 'local',
    status: 'connecting' as const,
    managed: false,
    tools: [{ name: 'mcp__local__one', description: 'One tool' }],
  },
  {
    serverName: 'down',
    status: 'down' as const,
    managed: true,
    tools: [{ name: 'mcp__down__one', description: '' }],
  },
]

interface BenchOptions {
  listError?: string
  reconnectError?: string
  servers?: typeof SERVERS
}

async function bench(opts: BenchOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listCalls: Array<{ payload: unknown; signal: AbortSignal | undefined }> = []
  const reconnectCalls: Array<{ serverName: string }> = []
  ctx.provide('connection', {
    api: {
      mcp: {
        list: async (payload: unknown, signal?: AbortSignal) => {
          listCalls.push({ payload, signal })
          if (opts.listError !== undefined) {
            return { rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message: opts.listError } } }
          }
          return { rpcId: 'r', result: { ok: true as const, value: { servers: opts.servers ?? SERVERS } } }
        },
        add: async () => ({ rpcId: 'r', result: { ok: true as const, value: { serverName: 'new' } } }),
        remove: async () => ({ rpcId: 'r', result: { ok: true as const, value: {} } }),
        reconnect: async (payload: { serverName: string }) => {
          reconnectCalls.push({ serverName: payload.serverName })
          if (opts.reconnectError !== undefined) {
            return { rpcId: 'r', result: { ok: false as const, error: { code: 'mcp-server-not-found', message: opts.reconnectError } } }
          }
          return { rpcId: 'r', result: { ok: true as const, value: {} } }
        },
      },
    },
  } as never)
  const openSectionCalls: Array<string | undefined> = []
  ctx.provide('settingsPanel', {
    openSection: (id?: string) => { openSectionCalls.push(id) },
    close: () => undefined,
    setActiveId: () => undefined,
    store: { getSnapshot: () => ({ open: false, activeId: undefined }), subscribe: () => () => undefined },
  } as never)
  const decorated: CommandDecoration[] = []
  ctx.provide('commandUi', {
    register() { throw new Error('ui-mcp registers no client contributions') },
    decorate(decoration: CommandDecoration) {
      decorated.push(decoration)
      return () => {
        const at = decorated.indexOf(decoration)
        if (at >= 0) decorated.splice(at, 1)
      }
    },
  })
  const fiber = ctx.plugin({ inject: [...inject, 'commandUi', 'settingsPanel'], apply })
  await fiber.await()
  return { fiber, decorated, listCalls, reconnectCalls, openSectionCalls }
}

/** The decorated host /mcp command, asserted to be a popupSelect. */
function mcpEntry(decorated: CommandDecoration[]): {
  available: (session: ClientSessionContext) => boolean
  ui: CommandPopupSelectSpec
} {
  const entry = decorated.find(item => item.name === 'mcp')
  expect(entry, 'the /mcp decoration').toBeDefined()
  expect(entry!.ui.kind).toBe('popupSelect')
  const ui = entry!.ui as CommandPopupSelectSpec
  return {
    available: entry!.available.bind(entry!),
    ui,
  }
}

describe('ui-mcp /mcp decoration', () => {
  it('registers the /mcp decoration on the host command', async () => {
    const env = await bench()
    try {
      expect(env.decorated.map(entry => entry.name)).toEqual(['mcp'])
      mcpEntry(env.decorated)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('is offered everywhere', async () => {
    const env = await bench()
    try {
      const mcp = mcpEntry(env.decorated)
      expect(mcp.available(session)).toBe(true)
      expect(mcp.available(({ sessionId: 'anyone' as never }))).toBe(true)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('lists each server with its status and tools, plus the trailing add row', async () => {
    const env = await bench()
    try {
      const mcp = mcpEntry(env.decorated)
      const options = await mcp.ui.options(session, new AbortController().signal)
      expect(options).toEqual([
        {
          id: 'websift',
          label: 'websift',
          detail: 'connected · 2 tools',
          confirmation: {
            title: 'Reconnect “websift”?',
            description: 'The connection is dropped and re-established from scratch. Tool calls in flight on this server are interrupted.',
            acknowledgeLabel: 'I understand in-flight tool calls on this server are interrupted',
            cancelLabel: 'Back',
            confirmLabel: 'Reconnect now',
          },
        },
        {
          id: 'github',
          label: 'github',
          detail: 'reconnecting · no tools',
          confirmation: {
            title: 'Reconnect “github”?',
            description: 'The connection is dropped and re-established from scratch. Tool calls in flight on this server are interrupted.',
            acknowledgeLabel: 'I understand in-flight tool calls on this server are interrupted',
            cancelLabel: 'Back',
            confirmLabel: 'Reconnect now',
          },
        },
        {
          id: 'local',
          label: 'local',
          detail: 'connecting · 1 tool',
          confirmation: {
            title: 'Reconnect “local”?',
            description: 'The connection is dropped and re-established from scratch. Tool calls in flight on this server are interrupted.',
            acknowledgeLabel: 'I understand in-flight tool calls on this server are interrupted',
            cancelLabel: 'Back',
            confirmLabel: 'Reconnect now',
          },
        },
        {
          id: 'down',
          label: 'down',
          detail: 'disconnected · 1 tool',
          confirmation: {
            title: 'Reconnect “down”?',
            description: 'The connection is dropped and re-established from scratch. Tool calls in flight on this server are interrupted.',
            acknowledgeLabel: 'I understand in-flight tool calls on this server are interrupted',
            cancelLabel: 'Back',
            confirmLabel: 'Reconnect now',
          },
        },
        { id: '__add__', label: 'Add an MCP server…', detail: 'Open the MCP settings to register a new server' },
      ])
      expect(env.listCalls).toHaveLength(1)
      expect(env.listCalls[0]!.payload).toEqual({})
      expect(env.listCalls[0]!.signal).toBeTypeOf('object')
    } finally {
      await env.fiber.dispose()
    }
  })

  it('an empty roster offers only the add row', async () => {
    const env = await bench({ servers: [] })
    try {
      const mcp = mcpEntry(env.decorated)
      const options = await mcp.ui.options(session, new AbortController().signal)
      expect(options).toEqual([
        { id: '__add__', label: 'Add an MCP server…', detail: 'Open the MCP settings to register a new server' },
      ])
    } finally {
      await env.fiber.dispose()
    }
  })

  it('a roster read failure rejects the options fetch', async () => {
    const env = await bench({ listError: 'registry refused' })
    try {
      const mcp = mcpEntry(env.decorated)
      await expect(mcp.ui.options(session, new AbortController().signal))
        .rejects.toThrow('registry refused')
    } finally {
      await env.fiber.dispose()
    }
  })

  it('the add row deep links into the MCP settings section', async () => {
    const env = await bench()
    try {
      const mcp = mcpEntry(env.decorated)
      await mcp.ui.onSelect({ id: '__add__', label: 'Add an MCP server…' }, session)
      expect(env.openSectionCalls).toEqual(['mcp'])
      expect(env.reconnectCalls).toHaveLength(0)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('a server pick drives the reconnect call', async () => {
    const env = await bench()
    try {
      const mcp = mcpEntry(env.decorated)
      await mcp.ui.onSelect({ id: 'github', label: 'github' }, session)
      expect(env.reconnectCalls).toEqual([{ serverName: 'github' }])
      // The reconnect is the whole pick; no other wire is touched.
      expect(env.openSectionCalls).toHaveLength(0)
    } finally {
      await env.fiber.dispose()
    }
  })

  it('a refused reconnect rejects the pick settle', async () => {
    const env = await bench({ reconnectError: 'no server reports github' })
    try {
      const mcp = mcpEntry(env.decorated)
      await expect(mcp.ui.onSelect({ id: 'github', label: 'github' }, session))
        .rejects.toThrow('no server reports github')
      expect(env.reconnectCalls).toEqual([{ serverName: 'github' }])
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
