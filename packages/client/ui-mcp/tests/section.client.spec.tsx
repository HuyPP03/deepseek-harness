// @vitest-environment jsdom
/**
 * The MCP settings section's rendering rules: the roster reads through the
 * controller once, every row shows its status and tools, a reconnect is a
 * per-row button, remove exists only for user-managed rows and gates behind
 * the acknowledgement, and the add form switches its fields on the transport.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { McpSection } from '../src/client/McpSection.tsx'
import type { McpSectionProps } from '../src/client/McpSection.tsx'
import type { McpSectionState } from '../src/client/section-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const READY: McpSectionState = {
  status: 'ready',
  error: null,
  rows: [
    {
      serverName: 'websift',
      status: 'connected',
      managed: false,
      tools: [
        { name: 'mcp__websift__web_search', description: 'Search' },
        { name: 'mcp__websift__web_fetch', description: 'Fetch' },
      ],
    },
    {
      serverName: 'github',
      status: 'reconnecting',
      managed: true,
      tools: [],
    },
  ],
  add: null,
  pendingRemove: null,
  removeAcknowledged: false,
  removing: false,
  reconnecting: null,
}

function renderSection(state: Partial<McpSectionState> = {}) {
  const store = createSnapshotStore<McpSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    beginAdd: vi.fn(),
    cancelAdd: vi.fn(),
    setAddField: vi.fn(),
    submitAdd: vi.fn(() => Promise.resolve()),
    beginRemove: vi.fn(),
    setRemoveAcknowledged: vi.fn(),
    remove: vi.fn(() => Promise.resolve()),
    reconnect: vi.fn(() => Promise.resolve()),
  }
  const props = {
    ...actions,
    useMcpSection: bindSnapshotSelector(store),
    t: (key: keyof typeof en, params?: Record<string, unknown>) => {
      let text = en[key]
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
      return text
    },
  } as unknown as McpSectionProps
  render(<McpSection {...props} />)
  return { actions, store }
}

/** Locate a row by the server name it prints. */
function rowFor(name: string): HTMLElement {
  return screen.getByTestId(`mcp-row-${name}`)
}

describe('the roster', () => {
  it('reads the roster once when it first renders', async () => {
    const { actions } = renderSection({ status: 'idle', rows: [] })
    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
  })

  it('shows the status words and the one-tool line', () => {
    renderSection({
      rows: [
        { serverName: 'a', status: 'connecting', managed: false, tools: [{ name: 't', description: '' }] },
        { serverName: 'b', status: 'down', managed: false, tools: [] },
      ],
    })
    expect(within(rowFor('a')).getByText(en.statusConnecting)).toBeTruthy()
    expect(within(rowFor('a')).getByText(en.toolsOne)).toBeTruthy()
    expect(within(rowFor('b')).getByText(en.statusDown)).toBeTruthy()
    expect(within(rowFor('b')).getByText(en.noTools)).toBeTruthy()
  })

  it('offers retry after a failed read', () => {
    const { actions } = renderSection({ status: 'error', error: 'list refused', rows: [] })
    fireEvent.click(screen.getByText(en.retry))
    expect(actions.load).toHaveBeenCalledTimes(2)
  })

  it('shows each row with its status word and tool count', () => {
    renderSection()
    const websift = rowFor('websift')
    expect(within(websift).getByText(en.statusConnected)).toBeTruthy()
    expect(within(websift).getByText('2 tools')).toBeTruthy()
    const github = rowFor('github')
    expect(within(github).getByText(en.statusReconnecting)).toBeTruthy()
    expect(within(github).getByText(en.noTools)).toBeTruthy()
  })

  it('renders the loading and empty states', () => {
    renderSection({ status: 'loading', rows: [] })
    expect(screen.getByText(en.loading)).toBeTruthy()
    cleanup()
    renderSection({ status: 'ready', rows: [] })
    expect(screen.getByText(en.noServers)).toBeTruthy()
  })

  it('shows the failure text with a retry', () => {
    const { actions } = renderSection({ status: 'error', error: 'list refused', rows: [] })
    expect(screen.getByText('list refused')).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    expect(actions.load).toHaveBeenCalledTimes(2)
  })

  it('falls back to the load error when the snapshot carries none', () => {
    renderSection({ status: 'error', error: null, rows: [] })
    expect(screen.getByText(en.loadError)).toBeTruthy()
  })

  it('renders the remaining lifecycle states and tool counts', () => {
    renderSection({
      rows: [
        { serverName: 'slow', status: 'connecting', managed: false, tools: [{ name: 'mcp__slow__one', description: 'One' }] },
        { serverName: 'down', status: 'down', managed: false, tools: [] },
      ],
    })
    const slow = rowFor('slow')
    expect(within(slow).getByText(en.statusConnecting)).toBeTruthy()
    expect(within(slow).getByText(en.toolsOne)).toBeTruthy()
    const down = rowFor('down')
    expect(within(down).getByText(en.statusDown)).toBeTruthy()
    expect(within(down).getByText(en.noTools)).toBeTruthy()
  })
})

describe('row actions', () => {
  it('offers reconnect on every row, remove only on managed rows', () => {
    const { actions } = renderSection()
    const websift = rowFor('websift')
    expect(within(websift).queryByText(en.remove)).toBeNull()
    fireEvent.click(within(websift).getByText(en.reconnect))
    expect(actions.reconnect).toHaveBeenCalledWith('websift')
    const github = rowFor('github')
    expect(within(github).getByText(en.remove)).toBeTruthy()
  })

  it('shows the in-flight reconnect state and disables its button', () => {
    const { actions } = renderSection({ reconnecting: 'websift' })
    const websift = rowFor('websift')
    expect(within(websift).getByText(en.reconnecting)).toBeTruthy()
    const button = within(websift).getByText(en.reconnecting).closest('button')!
    expect(button.disabled).toBe(true)
    expect(actions.reconnect).not.toHaveBeenCalled()
  })
})

describe('the remove gate', () => {
  it('opens over one server, confirms on acknowledgement, and dismisses', () => {
    const { actions, store } = renderSection()
    fireEvent.click(within(rowFor('github')).getByText(en.remove))
    expect(actions.beginRemove).toHaveBeenCalledWith('github')
    // The gate renders over the acknowledged snapshot state.
    act(() => {
      store.set({ ...store.getSnapshot(), pendingRemove: 'github', removeAcknowledged: false })
    })
    expect(screen.getByText(en.removeAcknowledge)).toBeTruthy()
    const confirm = screen.getByText(en.removeConfirm)
    expect(confirm.closest('button')!.disabled).toBe(true)
    fireEvent.click(screen.getByText(en.removeAcknowledge))
    expect(actions.setRemoveAcknowledged).toHaveBeenCalledWith(true)
    act(() => {
      store.set({ ...store.getSnapshot(), removeAcknowledged: true })
    })
    expect(confirm.closest('button')!.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(actions.remove).toHaveBeenCalled()
    act(() => {
      store.set({ ...store.getSnapshot(), pendingRemove: null })
    })
    expect(screen.queryByText(en.removeConfirm)).toBeNull()
  })

  it('dismisses the gate with the back button', () => {
    const { actions } = renderSection({ pendingRemove: 'github' })
    fireEvent.click(screen.getByText(en.removeCancel))
    expect(actions.beginRemove).toHaveBeenLastCalledWith(null)
  })

  it('shows the in-flight removing state', () => {
    renderSection({ pendingRemove: 'github', removing: true })
    expect(screen.getByText(en.removing)).toBeTruthy()
  })
})

describe('the add form', () => {
  function openForm() {
    const { actions, store } = renderSection()
    fireEvent.click(screen.getByText(en.add))
    expect(actions.beginAdd).toHaveBeenCalled()
    act(() => {
      store.set({ ...store.getSnapshot(), add: {
        serverName: '', transport: 'stdio', command: '', args: '', env: '', cwd: '',
        url: '', headers: '', timeoutMs: '', saving: false, error: null,
      } })
    })
    return { actions, store, dialog: () => screen.getByText(en.addTitle).closest<HTMLElement>('[role="dialog"]')! }
  }

  it('opens from the header button and closes with cancel', () => {
    const { actions, dialog } = openForm()
    expect(screen.getByText(en.addTitle)).toBeTruthy()
    expect(screen.getByPlaceholderText(en.serverNamePlaceholder)).toBeTruthy()
    expect(within(dialog()).getByText(en.command)).toBeTruthy()
    fireEvent.click(within(dialog()).getByText(en.cancel))
    expect(actions.cancelAdd).toHaveBeenCalled()
  })

  it('closes with the dialog close button', () => {
    const { actions, dialog } = openForm()
    const close = dialog().querySelector('button[aria-label]')!
    fireEvent.click(close)
    expect(actions.cancelAdd).toHaveBeenCalledTimes(1)
  })

  it('routes every field edit through setAddField', () => {
    const { actions, store, dialog } = openForm()
    const d = dialog()
    fireEvent.change(within(d).getByPlaceholderText(en.serverNamePlaceholder), { target: { value: 'new' } })
    fireEvent.change(within(d).getByPlaceholderText(en.commandPlaceholder), { target: { value: 'node' } })
    fireEvent.change(within(d).getByPlaceholderText(en.argsPlaceholder), { target: { value: '--port' } })
    fireEvent.change(within(d).getByPlaceholderText(en.envPlaceholder), { target: { value: 'A=1' } })
    fireEvent.change(within(d).getByPlaceholderText(en.cwdPlaceholder), { target: { value: '/tmp' } })
    fireEvent.change(within(d).getByPlaceholderText(en.timeoutPlaceholder), { target: { value: '60000' } })
    expect(actions.setAddField).toHaveBeenCalledWith('serverName', 'new')
    expect(actions.setAddField).toHaveBeenCalledWith('command', 'node')
    expect(actions.setAddField).toHaveBeenCalledWith('args', '--port')
    expect(actions.setAddField).toHaveBeenCalledWith('env', 'A=1')
    expect(actions.setAddField).toHaveBeenCalledWith('cwd', '/tmp')
    expect(actions.setAddField).toHaveBeenCalledWith('timeoutMs', '60000')
    // The transport switch and the http fields (a re-render shows them).
    const transportLabel = within(d).getByText(en.transport).closest('label') as HTMLElement
    fireEvent.change(within(transportLabel).getByRole('combobox'), { target: { value: 'streamable-http' } })
    expect(actions.setAddField).toHaveBeenCalledWith('transport', 'streamable-http')
    act(() => {
      store.set({ ...store.getSnapshot(), add: { ...store.getSnapshot().add!, transport: 'streamable-http' } })
    })
    fireEvent.change(within(d).getByPlaceholderText(en.urlPlaceholder), { target: { value: 'https://example.com/mcp' } })
    expect(actions.setAddField).toHaveBeenCalledWith('url', 'https://example.com/mcp')
    fireEvent.change(within(d).getByPlaceholderText(en.headersPlaceholder), { target: { value: 'A: 1' } })
    expect(actions.setAddField).toHaveBeenCalledWith('headers', 'A: 1')
  })

  it('submits a submittable draft through create', () => {
    const { actions, store } = openForm()
    act(() => {
      store.set({ ...store.getSnapshot(), add: {
        serverName: 'new', transport: 'stdio', command: 'node', args: '', env: '', cwd: '',
        url: '', headers: '', timeoutMs: '', saving: false, error: null,
      } })
    })
    const create = screen.getByText(en.create)
    expect(create.closest('button')!.disabled).toBe(false)
    fireEvent.click(create)
    expect(actions.submitAdd).toHaveBeenCalledTimes(1)
  })

  it('switches the fields on the transport', () => {
    const { store } = renderSection({
      add: { serverName: '', transport: 'stdio', command: '', args: '', env: '', cwd: '', url: '', headers: '', timeoutMs: '', saving: false, error: null },
    })
    const form = () => screen.getByText(en.addTitle).closest<HTMLElement>('[role="dialog"]')!
    expect(within(form()).queryByText(en.url)).toBeNull()
    act(() => {
      store.set({ ...store.getSnapshot(), add: { ...store.getSnapshot().add!, transport: 'streamable-http' } })
    })
    expect(within(form()).getByText(en.url)).toBeTruthy()
    expect(within(form()).queryByText(en.command)).toBeNull()
  })

  it('shows the first blocker as the form message and disables create', () => {
    const { actions } = renderSection({
      add: { serverName: '', transport: 'stdio', command: '', args: '', env: '', cwd: '', url: '', headers: '', timeoutMs: '', saving: false, error: null },
    })
    const form = () => screen.getByText(en.addTitle).closest<HTMLElement>('[role="dialog"]')!
    expect(screen.getByText(en.nameRequired)).toBeTruthy()
    expect(within(form()).getByText(en.create).closest('button')!.disabled).toBe(true)
    expect(actions.submitAdd).not.toHaveBeenCalled()
  })

  it('shows a host add failure on the form', () => {
    renderSection({
      add: { serverName: 'new', transport: 'stdio', command: 'node', args: '', env: '', cwd: '', url: '', headers: '', timeoutMs: '', saving: false, error: 'taken' },
    })
    expect(screen.getByText('taken')).toBeTruthy()
  })

  it('shows the creating state while the add is in flight', () => {
    renderSection({
      add: { serverName: 'new', transport: 'stdio', command: 'node', args: '', env: '', cwd: '', url: '', headers: '', timeoutMs: '', saving: true, error: null },
    })
    const form = screen.getByText(en.addTitle).closest<HTMLElement>('[role="dialog"]')!
    expect(within(form).getByText(en.creating).closest('button')!.disabled).toBe(true)
  })
})
