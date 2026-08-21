/**
 * The MCP section controller: the roster pull, the add form's parse-and-submit,
 * the remove gate, and the reconnect, each writing through the mcp wire calls
 * and re-reading the roster afterwards. The host stays the single fact source;
 * these specs pin what the page does with each answer.
 */

import { describe, expect, it } from 'vitest'
import { McpSectionController, blankDraft, draftBlocker, specOf } from '../src/client/section-store.ts'
import type { McpServerRow } from '@deepseek-ai/dsh-api-remotes/client'

/** One roster row for the fakes. */
const ROWS: McpServerRow[] = [
  {
    serverName: 'websift',
    status: 'connected',
    managed: false,
    tools: [{ name: 'mcp__websift__web_search', description: 'Search' }],
  },
  {
    serverName: 'github',
    status: 'reconnecting',
    managed: true,
    tools: [],
  },
]

const ok = <T>(value: T) => ({ rpcId: 'r', result: { ok: true as const, value } })
const err = (code: string, message: string) => ({ rpcId: 'r', result: { ok: false as const, error: { code, message } } })

interface WireCalls {
  list: number
  add: Array<{ spec: unknown }>
  remove: Array<{ serverName: string }>
  reconnect: Array<{ serverName: string }>
}

function wire(opts: {
  listValue?: { servers: readonly McpServerRow[] }
  listError?: string
  addError?: string
  removeError?: string
  reconnectError?: string
  removeThrow?: string
  reconnectThrow?: string
} = {}) {
  const calls: WireCalls = { list: 0, add: [], remove: [], reconnect: [] }
  return {
    calls,
    mcp: {
      list: async () => {
        calls.list += 1
        return opts.listError !== undefined
          ? err(opts.listError, 'list refused')
          : ok({ servers: opts.listValue?.servers ?? ROWS })
      },
      add: async (payload: { spec: unknown }) => {
        calls.add.push({ spec: payload.spec })
        return opts.addError !== undefined
          ? err('mcp-server-exists', opts.addError)
          : ok({ serverName: 'new' })
      },
      remove: async (payload: { serverName: string }) => {
        calls.remove.push({ serverName: payload.serverName })
        if (opts.removeThrow !== undefined) throw new Error(opts.removeThrow)
        return opts.removeError !== undefined
          ? err('mcp-server-not-managed', opts.removeError)
          : ok({})
      },
      reconnect: async (payload: { serverName: string }) => {
        calls.reconnect.push({ serverName: payload.serverName })
        if (opts.reconnectThrow !== undefined) throw new Error(opts.reconnectThrow)
        return opts.reconnectError !== undefined
          ? err('mcp-server-not-found', opts.reconnectError)
          : ok({})
      },
    },
  }
}

describe('McpSectionController.load', () => {
  it('reads the roster and reports ready with deep-copied rows', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.rows).toEqual(ROWS)
    expect(calls.list).toBe(1)
  })

  it('an empty roster is a valid deployment, not an error', async () => {
    const { mcp } = wire({ listValue: { servers: [] } })
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.rows).toEqual([])
  })

  it('a refused read reports the host answer', async () => {
    const { mcp } = wire({ listError: 'boom' })
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('list refused')
  })

  it('a carrier failure reports the thrown text', async () => {
    const controller = new McpSectionController({
      mcp: {
        list: async () => { throw new Error('network down') },
        add: async () => ok({ serverName: 'x' }),
        remove: async () => ok({}),
        reconnect: async () => ok({}),
      },
    } as never)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'Error: network down' })
  })
})

describe('McpSectionController add form', () => {
  it('opens a blank draft and cancels it', () => {
    const { mcp } = wire()
    const controller = new McpSectionController({ mcp } as never)
    controller.beginAdd()
    expect(controller.store.getSnapshot().add).toEqual(blankDraft())
    controller.cancelAdd()
    expect(controller.store.getSnapshot().add).toBeNull()
  })

  it('field edits store the typed value and clear the last failure', () => {
    const { mcp } = wire()
    const controller = new McpSectionController({ mcp } as never)
    controller.beginAdd()
    controller.setAddField('serverName', 'new')
    controller.setAddField('command', 'node server.js')
    const add = controller.store.getSnapshot().add!
    expect(add.serverName).toBe('new')
    expect(add.command).toBe('node server.js')
    expect(add.error).toBeNull()
  })

  it('a refused add keeps the form open on the host answer', async () => {
    const { mcp, calls } = wire({ addError: 'taken' })
    const controller = new McpSectionController({ mcp } as never)
    controller.beginAdd()
    controller.setAddField('serverName', 'new')
    controller.setAddField('command', 'node')
    await controller.submitAdd()
    const add = controller.store.getSnapshot().add!
    expect(add.saving).toBe(false)
    expect(add.error).toBe('taken')
    expect(calls.add).toHaveLength(1)
  })

  it('a carrier failure on add keeps the form open', async () => {
    const controller = new McpSectionController({
      mcp: {
        list: async () => ok({ servers: [] }),
        add: async () => { throw new Error('wire down') },
        remove: async () => ok({}),
        reconnect: async () => ok({}),
      },
    } as never)
    controller.beginAdd()
    controller.setAddField('serverName', 'new')
    controller.setAddField('command', 'node')
    await controller.submitAdd()
    const add = controller.store.getSnapshot().add!
    expect(add.saving).toBe(false)
    expect(add.error).toBe('Error: wire down')
  })

  it('a submittable add closes the form and re-reads the roster', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    controller.beginAdd()
    controller.setAddField('serverName', 'new')
    controller.setAddField('command', 'node server.js')
    controller.setAddField('args', '--port 8080\n')
    controller.setAddField('env', 'TOKEN=abc\n\n')
    controller.setAddField('cwd', '/tmp')
    controller.setAddField('timeoutMs', '5000')
    await controller.submitAdd()
    const state = controller.store.getSnapshot()
    expect(state.add).toBeNull()
    expect(state.status).toBe('ready')
    expect(calls.add).toEqual([{
      spec: {
        serverName: 'new',
        transport: 'stdio',
        command: 'node server.js',
        args: ['--port', '8080'],
        env: { TOKEN: 'abc' },
        cwd: '/tmp',
        toolCallTimeoutMs: 5000,
      },
    }])
    // The re-read after the add.
    expect(calls.list).toBe(2)
  })

  it('a blank or invalid draft does not reach the wire', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    controller.beginAdd()
    await controller.submitAdd()
    expect(calls.add).toHaveLength(0)
    controller.setAddField('serverName', 'too long a name that goes on and on past the limit')
    await controller.submitAdd()
    expect(calls.add).toHaveLength(0)
    controller.setAddField('serverName', 'websift')
    await controller.submitAdd()
    expect(calls.add).toHaveLength(0)
    expect(controller.store.getSnapshot().add).not.toBeNull()
  })

  it('parses the streamable-http draft into its wire spec', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    controller.beginAdd()
    controller.setAddField('serverName', 'remote')
    controller.setAddField('transport', 'streamable-http')
    controller.setAddField('url', 'https://example.com/mcp')
    controller.setAddField('headers', 'Authorization: Bearer tok\n')
    controller.setAddField('timeoutMs', '5000')
    await controller.submitAdd()
    expect(calls.add).toEqual([{
      spec: {
        serverName: 'remote',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer tok' },
        toolCallTimeoutMs: 5000,
      },
    }])
  })

  it('submits with a form that was never opened as a no-op', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.submitAdd()
    expect(calls.add).toHaveLength(0)
    // A field edit with no open form is likewise a no-op.
    controller.setAddField('serverName', 'new')
    expect(controller.store.getSnapshot().add).toBeNull()
  })
})

describe('McpSectionController remove gate', () => {
  it('opens over one server and dismisses with null', () => {
    const { mcp } = wire()
    const controller = new McpSectionController({ mcp } as never)
    controller.beginRemove('github')
    expect(controller.store.getSnapshot()).toMatchObject({ pendingRemove: 'github', removeAcknowledged: false })
    controller.beginRemove(null)
    expect(controller.store.getSnapshot().pendingRemove).toBeNull()
  })

  it('a refused remove keeps the failure on the page and closes the gate', async () => {
    const { mcp, calls } = wire({ removeError: 'profile-owned' })
    const controller = new McpSectionController({ mcp } as never)
    controller.beginRemove('websift')
    await controller.remove()
    const state = controller.store.getSnapshot()
    expect(state.removing).toBe(false)
    expect(state.pendingRemove).toBeNull()
    expect(state.error).toBe('profile-owned')
    expect(calls.remove).toEqual([{ serverName: 'websift' }])
  })

  it('a successful remove re-reads the roster', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    controller.beginRemove('github')
    await controller.remove()
    const state = controller.store.getSnapshot()
    expect(state.removing).toBe(false)
    expect(state.pendingRemove).toBeNull()
    expect(state.status).toBe('ready')
    expect(calls.remove).toEqual([{ serverName: 'github' }])
    expect(calls.list).toBe(2)
  })

  it('a carrier failure on remove closes the gate with the thrown text', async () => {
    const { mcp, calls } = wire({ removeThrow: 'wire down' })
    const controller = new McpSectionController({ mcp } as never)
    controller.beginRemove('github')
    await controller.remove()
    const state = controller.store.getSnapshot()
    expect(state.removing).toBe(false)
    expect(state.pendingRemove).toBeNull()
    expect(state.error).toBe('Error: wire down')
    expect(calls.remove).toEqual([{ serverName: 'github' }])
  })

  it('removes nothing while the gate is closed', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.remove()
    expect(calls.remove).toHaveLength(0)
  })

  it('toggles the acknowledgement with the checkbox', () => {
    const { mcp } = wire()
    const controller = new McpSectionController({ mcp } as never)
    controller.beginRemove('github')
    controller.setRemoveAcknowledged(true)
    expect(controller.store.getSnapshot().removeAcknowledged).toBe(true)
    controller.setRemoveAcknowledged(false)
    expect(controller.store.getSnapshot().removeAcknowledged).toBe(false)
  })

  it('keeps the gate and the checkbox put while a remove is in flight', async () => {
    let release!: (value: unknown) => void
    const pending = new Promise((resolve) => { release = resolve })
    const controller = new McpSectionController({
      mcp: {
        list: async () => ok({ servers: [] }),
        add: async () => ok({ serverName: 'x' }),
        remove: () => pending,
        reconnect: async () => ok({}),
      },
    } as never)
    controller.beginRemove('github')
    const inFlight = controller.remove()
    controller.beginRemove('websift')
    controller.setRemoveAcknowledged(true)
    expect(controller.store.getSnapshot()).toMatchObject({ pendingRemove: 'github', removeAcknowledged: false })
    release(ok({}))
    await inFlight
    expect(controller.store.getSnapshot().removing).toBe(false)
  })
})

describe('McpSectionController.reconnect', () => {
  it('asks one server to reconnect and re-reads the roster', async () => {
    const { mcp, calls } = wire()
    const controller = new McpSectionController({ mcp } as never)
    await controller.load()
    await controller.reconnect('websift')
    const state = controller.store.getSnapshot()
    expect(state.reconnecting).toBeNull()
    expect(state.status).toBe('ready')
    expect(calls.reconnect).toEqual([{ serverName: 'websift' }])
    expect(calls.list).toBe(2)
  })

  it('a refused reconnect keeps the failure on the page', async () => {
    const { mcp, calls } = wire({ reconnectError: 'not reported' })
    const controller = new McpSectionController({ mcp } as never)
    await controller.reconnect('gone')
    const state = controller.store.getSnapshot()
    expect(state.reconnecting).toBeNull()
    expect(state.error).toBe('not reported')
    expect(calls.reconnect).toEqual([{ serverName: 'gone' }])
  })

  it('a carrier failure on reconnect reports the thrown text', async () => {
    const { mcp, calls } = wire({ reconnectThrow: 'wire down' })
    const controller = new McpSectionController({ mcp } as never)
    await controller.reconnect('gone')
    const state = controller.store.getSnapshot()
    expect(state.reconnecting).toBeNull()
    expect(state.error).toBe('Error: wire down')
    expect(calls.reconnect).toEqual([{ serverName: 'gone' }])
  })

  it('one reconnect runs at a time', async () => {
    let release!: () => void
    let settled = false
    const pending = new Promise<void>((resolve) => { release = resolve })
    const calls: string[] = []
    const controller = new McpSectionController({
      mcp: {
        list: async () => ok({ servers: [] }),
        add: async () => ok({ serverName: 'x' }),
        remove: async () => ok({}),
        reconnect: async (payload: { serverName: string }) => {
          calls.push(payload.serverName)
          if (!settled) {
            settled = true
            await pending
          }
          return ok({})
        },
      },
    } as never)
    const first = controller.reconnect('a')
    // While the first is in flight, the second is a no-op.
    const second = controller.reconnect('b')
    release()
    await Promise.all([first, second])
    expect(calls).toEqual(['a'])
  })
})

describe('draftBlocker', () => {
  const rows = ROWS
  const base = blankDraft()

  it('requires a name, then the name rule, then a collision', () => {
    expect(draftBlocker(base, rows)).toBe('nameRequired')
    expect(draftBlocker({ ...base, serverName: 'x y' }, rows)).toBe('nameInvalid')
    expect(draftBlocker({ ...base, serverName: 'websift' }, rows)).toBe('nameTaken')
  })

  it('requires a command for stdio', () => {
    expect(draftBlocker({ ...base, serverName: 'new' }, rows)).toBe('commandRequired')
    expect(draftBlocker({ ...base, serverName: 'new', command: 'node' }, rows)).toBeUndefined()
  })

  it('requires a valid URL for streamable-http', () => {
    const http = { ...base, serverName: 'new', transport: 'streamable-http' as const }
    expect(draftBlocker(http, rows)).toBe('urlRequired')
    expect(draftBlocker({ ...http, url: 'not a url' }, rows)).toBe('urlInvalid')
    expect(draftBlocker({ ...http, url: 'https://example.com/mcp' }, rows)).toBeUndefined()
  })
})

describe('specOf', () => {
  it('omits blank stdio fields from the wire spec', () => {
    const spec = specOf({ ...blankDraft(), serverName: 'new', command: 'node' })
    expect(spec).toEqual({ serverName: 'new', transport: 'stdio', command: 'node' })
  })

  it('omits the headers block when the http draft has none', () => {
    const spec = specOf({
      ...blankDraft(),
      serverName: 'new',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
    })
    expect(spec).toEqual({ serverName: 'new', transport: 'streamable-http', url: 'https://example.com/mcp' })
  })

  it('drops separator-less env and header lines', () => {
    const spec = specOf({
      ...blankDraft(),
      serverName: 'new',
      command: 'node',
      env: 'GOOD=1\nnope\n',
    })
    expect((spec as { env?: Record<string, string> }).env).toEqual({ GOOD: '1' })
    const http = specOf({
      ...blankDraft(),
      serverName: 'new',
      transport: 'streamable-http',
      url: 'https://example.com',
      headers: 'A: 1\nmalformed\n',
    })
    expect((http as { headers?: Record<string, string> }).headers).toEqual({ A: '1' })
  })

  it('ignores an invalid timeout', () => {
    const spec = specOf({ ...blankDraft(), serverName: 'new', command: 'node', timeoutMs: 'abc' })
    expect('toolCallTimeoutMs' in spec).toBe(false)
  })
})
