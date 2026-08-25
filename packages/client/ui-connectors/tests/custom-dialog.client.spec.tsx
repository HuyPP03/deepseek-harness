/**
 * Custom connector dialog suite: the add flow over a real controller and a
 * fake wire, plus the remove action on a custom row.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConnectorView, IApiClient, RpcId, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { ConnectorsSectionController } from '../src/client/controller.ts'
import { ConnectorsDirectory } from '../src/client/ConnectorsDirectory.tsx'
import type { ConnectorsDirectoryProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'

type ConnectorDouble = Pick<IApiClient['connectors'],
  'list' | 'configure' | 'connect' | 'disconnect' | 'authorize' | 'deviceLogin' | 'add' | 'remove'>

afterEach(() => {
  cleanup()
})

function view(overrides: Partial<ConnectorView> = {}): ConnectorView {
  return {
    id: 'my-svc',
    name: 'My Service',
    description: 'A user-authored connector.',
    presetId: 'my-svc',
    state: 'unconfigured',
    custom: true,
    auth: [],
    servers: [{ serverName: 'my-svc', mounted: false }],
    suggestions: [],
    ...overrides,
  }
}

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: 'r' as RpcId, result: { ok: true as const, value } }
}

function err(message: string): RpcResponse<never> {
  return { rpcId: 'r' as RpcId, result: { ok: false as const, error: { code: 'internal', message, details: {} } } }
}

function baseWire(rows: readonly ConnectorView[]): ConnectorDouble {
  return {
    list: vi.fn(async () => ok({ connectors: [...rows] })),
    configure: vi.fn(async () => ok({ connector: view({ state: 'connected' }) })),
    connect: vi.fn(async () => ok({ connector: view({ state: 'connected' }) })),
    disconnect: vi.fn(async () => ok({ connector: view({ state: 'unconfigured' }) })),
    authorize: vi.fn(async () => ok({ authorizationUrl: 'http://127.0.0.1:8766/authorize', expiresAt: Date.now() + 300_000 })),
    deviceLogin: vi.fn(async () => ok({ status: 'ready' as const, expiresAt: Date.now() })),
    add: vi.fn(async () => ok({ id: 'custom' })),
    remove: vi.fn(async () => ok({})),
  }
}

function mountRow(wire: ConnectorDouble) {
  const controller = new ConnectorsSectionController({ connectors: wire })
  const props = {
    t: (key: string, params?: Record<string, unknown>) =>
      (en as Record<string, string>)[key]!.replace(
        /\{(\w+)}/g, (m, name: string) => (name in (params ?? {}) ? String(params?.[name]) : m),
      ),
    useConnectors: bindSnapshotSelector(controller.store),
    load: () => controller.load(),
    openTokenDialog: (id: string) => { controller.openTokenDialog(id) },
    setDialogDraft: (ref: string, value: string) => { controller.setDialogDraft(ref, value) },
    closeDialog: () => { controller.closeDialog() },
    saveToken: () => controller.saveToken(),
    connect: (id: string, mode?: 'token' | 'oauth' | 'device') => controller.connect(id, mode),
    authorize: (id: string) => controller.authorize(id),
    deviceLogin: (id: string) => controller.deviceLogin(id),
    disconnect: (id: string) => controller.disconnect(id),
    selectProvider: (id: string | null) => { controller.selectProvider(id) },
    openCustomDialog: () => { controller.openCustomDialog() },
    setCustomDraft: (field: string, value: string) => { controller.setCustomDraft(field, value) },
    closeCustomDialog: () => { controller.closeCustomDialog() },
    saveCustom: () => controller.saveCustom(),
    removeCustom: (id: string) => controller.removeCustom(id),
    useSessions: (selector: (s: never) => unknown) => selector({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} } as never),
    openSession: vi.fn(),
    newProviderChat: vi.fn(() => Promise.resolve()),
  }
  render(<ConnectorsDirectory {...(props as unknown as ConnectorsDirectoryProps)} />)
  return controller
}

describe('custom connector dialog', () => {
  it('opens from the New connector control over an empty stdio draft', async () => {
    const controller = mountRow(baseWire([view()]))
    await waitFor(() => expect(controller.store.getSnapshot().status).toBe('ready'))
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('New custom connector')).toBeTruthy()
    // The stdio default shows the command field; the http field is hidden.
    expect(within(dialog).getByText('Command')).toBeTruthy()
    expect(within(dialog).queryByText('URL')).toBeNull()
  })

  it('saves a stdio draft through connector.add and re-lists', async () => {
    const wire = baseWire([view()])
    const controller = mountRow(wire)
    await waitFor(() => expect(controller.store.getSnapshot().status).toBe('ready'))
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('My Service'), { target: { value: 'Acme API' } })
    fireEvent.change(within(dialog).getByPlaceholderText('my-service'), { target: { value: 'acme' } })
    fireEvent.change(within(dialog).getByPlaceholderText('npx'), { target: { value: 'npx' } })
    fireEvent.change(within(dialog).getByPlaceholderText('-y, @example/mcp-server'), { target: { value: '-y, @acme/mcp' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(wire.add).toHaveBeenCalledWith({
      spec: { name: 'Acme API', id: 'acme', transport: 'stdio', command: 'npx', args: ['-y', '@acme/mcp'] },
    }))
    await waitFor(() => expect((wire.list as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('switches to streamable-http and saves the url with the header flag', async () => {
    const wire = baseWire([view()])
    const controller = mountRow(wire)
    await waitFor(() => expect(controller.store.getSnapshot().status).toBe('ready'))
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('My Service'), { target: { value: 'Remote' } })
    const httpRadio = within(dialog).getByRole('radio', { name: /streamable-http/ })
    const stdioRadio = within(dialog).getByRole('radio', { name: /stdio/ })
    fireEvent.click(httpRadio)
    // A transport round-trip keeps the draft: back to stdio and to http.
    fireEvent.click(stdioRadio)
    fireEvent.click(httpRadio)
    fireEvent.change(within(dialog).getByPlaceholderText('https://example.com/mcp'), { target: { value: 'https://mcp.example.com' } })
    fireEvent.change(within(dialog).getByPlaceholderText('MY_SERVICE_TOKEN'), { target: { value: 'AUTHORIZATION' } })
    const headerFlag = within(dialog).getByRole('checkbox')
    fireEvent.click(headerFlag)
    // Unchecking flips the draft back to false before the final check.
    fireEvent.click(headerFlag)
    fireEvent.click(headerFlag)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(wire.add).toHaveBeenCalledWith({
      spec: {
        name: 'Remote', transport: 'streamable-http', url: 'https://mcp.example.com',
        tokenVar: 'AUTHORIZATION', tokenVarIsHeader: true,
      },
    }))
  })

  it('keeps the draft and shows the failure when the host rejects the add', async () => {
    const wire = baseWire([view()])
    wire.add = vi.fn(async () => err('name required')) as unknown as typeof wire.add
    const controller = mountRow(wire)
    await waitFor(() => expect(controller.store.getSnapshot().status).toBe('ready'))
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('My Service'), { target: { value: 'X' } })
    fireEvent.change(within(dialog).getByPlaceholderText('npx'), { target: { value: 'npx' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(within(dialog).getByText('name required')).toBeTruthy())
    expect(controller.store.getSnapshot().customDialog).not.toBeNull()
  })

  it('removes a custom row through the Remove button and re-lists', async () => {
    const wire = baseWire([view()])
    const controller = mountRow(wire)
    await waitFor(() => expect(controller.store.getSnapshot().status).toBe('ready'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(wire.remove).toHaveBeenCalledWith({ id: 'my-svc' }))
    await waitFor(() => expect((wire.list as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('offers Remove only on custom rows', async () => {
    const controller = mountRow(baseWire([view(), view({ id: 'github', name: 'GitHub', custom: false })]))
    await waitFor(() => expect(controller.store.getSnapshot().status).toBe('ready'))
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
  })
})
