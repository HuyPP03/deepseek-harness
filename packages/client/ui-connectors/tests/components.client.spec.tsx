// @vitest-environment jsdom
/**
 * The region's rendering rules: which message a status shows, which action a
 * state offers, the rail affordance, and the token dialog's field, guard, and
 * error display.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ConnectorsRegion } from '../src/client/ConnectorsRegion.tsx'
import type { ConnectorsRegionProps } from '../src/client/contract/slots.ts'
import { ConnectorsSectionController } from '../src/client/controller.ts'
import type { ConnectorsSectionState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import type { ConnectorView } from '@deepseek-ai/dsh-api-remotes/client'

afterEach(cleanup)

function view(withFields: Partial<ConnectorView> & { id: string }): ConnectorView {
  return {
    name: withFields.id,
    description: 'a description',
    presetId: 'preset',
    state: 'connected',
    custom: false,
    servers: [],
    auth: [],
    suggestions: [],
    ...withFields,
  }
}

const ROSTER: readonly ConnectorView[] = [
  view({ id: 'atlas', description: 'Atlassian Cloud', state: 'unconfigured', auth: [{ mode: 'token', configured: false, howTo: 'Create a token.' }] }),
  view({ id: 'notion', description: 'Notion workspace', state: 'needs-auth', auth: [{ mode: 'token', configured: true }] }),
  view({ id: 'github', description: 'GitHub account', state: 'connected', servers: [{ serverName: 'github', mounted: true, status: 'connected' }, { serverName: 'gh-mirror', mounted: true, status: 'connected' }] }),
  view({ id: 'slack', description: 'Slack workspace', state: 'error', lastError: 'the mount was refused', servers: [{ serverName: 'slack', mounted: false, status: 'down' }] }),
  view({ id: 'jira', description: 'Jira project', state: 'error' }),
  view({ id: 'google', description: 'Google Drive', state: 'unconfigured', auth: [{ mode: 'oauth', configured: false, howTo: 'Run the provider setup.' }] }),
  view({ id: 'dropbox', description: 'Dropbox account', state: 'unconfigured', auth: [{ mode: 'oauth', configured: false }] }),
  view({ id: 'm365', description: 'Microsoft 365', state: 'authorizing', custom: true }),
]

const READY: ConnectorsSectionState = {
  status: 'ready',
  error: null,
  connectors: ROSTER,
  selectedProvider: null,
  providerServerNames: [],
  busyId: null,
  opError: null,
  dialog: null,
}

function renderRegion(
  state: Partial<ConnectorsSectionState> = {},
  options: { wide?: boolean } = {},
) {
  const store = createSnapshotStore<ConnectorsSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    openTokenDialog: vi.fn(),
    setDialogDraft: vi.fn(),
    closeDialog: vi.fn(),
    saveToken: vi.fn(() => Promise.resolve()),
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
  }
  const props = {
    wide: options.wide ?? true,
    expandSidebar: vi.fn(),
    t: (key: string, params?: Record<string, unknown>) =>
      (en as Record<string, string>)[key]!.replace(
        /\{(\w+)}/g, (m, name: string) => (name in (params ?? {}) ? String(params?.[name]) : m),
      ),
    useConnectors: bindSnapshotSelector(store),
    ...actions,
  }
  const viewApi = render(<ConnectorsRegion {...(props as unknown as ConnectorsRegionProps)} />)
  return { ...actions, expandSidebar: props.expandSidebar, view: viewApi }
}

/** The one-row roster the dialog tests drive: an unconfigured multi-reference token connector. */
const DRIVEN_ROW = view({
  id: 'atlas',
  description: 'Atlassian Cloud',
  state: 'unconfigured',
  auth: [{
    mode: 'token', configured: false, howTo: 'Create a token in your dashboard.',
    credentialRefs: ['ATLASSIAN_USERNAME', 'ATLASSIAN_TOKEN'],
  }],
})

/** The response view a successful configure/connect adopts. */
const DRIVEN_CONNECTED = view({
  id: 'atlas',
  description: 'Atlassian Cloud',
  state: 'connected',
  auth: [{ mode: 'token', configured: true }],
})

function okView() {
  return { rpcId: 'r', result: { ok: true as const, value: { connector: DRIVEN_CONNECTED } } }
}

/**
 * Render over a real controller and a fake connector api: the dialog's
 * draft, guard, and failure display are controller facts, so the driven
 * runtime keeps the store and the actions honest.
 */
async function renderDriven(overrides: Partial<{
  configure: () => Promise<unknown>
  connect: () => Promise<unknown>
  disconnect: () => Promise<unknown>
}> = {}, row: ConnectorView = DRIVEN_ROW) {
  const connectors = {
    list: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connectors: [row] } } })),
    configure: vi.fn(async () => okView()),
    connect: vi.fn(async () => okView()),
    disconnect: vi.fn(async () => okView()),
    ...overrides,
  }
  const controller = new ConnectorsSectionController({ connectors } as never)
  const props = {
    wide: true,
    expandSidebar: vi.fn(),
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
    connect: (id: string) => controller.connect(id),
    disconnect: (id: string) => controller.disconnect(id),
  }
  const viewApi = render(<ConnectorsRegion {...(props as unknown as ConnectorsRegionProps)} />)
  await waitFor(() => {
    expect(controller.store.getSnapshot().status).toBe('ready')
  })
  return { connectors, controller, view: viewApi }
}

describe('ConnectorsRegion', () => {
  it('reads the roster on mount and shows the loading message until ready', () => {
    const a = renderRegion({ status: 'loading', connectors: [] })
    expect(a.load).toHaveBeenCalledOnce()
    expect(screen.getByText('Loading connectors…')).toBeTruthy()
  })

  it('shows the read failure with a retry that re-reads', () => {
    const a = renderRegion({ status: 'error', error: 'roster down', connectors: [] })
    expect(screen.getByText('roster down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(a.load).toHaveBeenCalledTimes(2)
  })

  it('shows the empty state for a deployment with no connectors', () => {
    renderRegion({ status: 'ready', connectors: [] })
    expect(screen.getByText('No connectors are composed on this deployment.')).toBeTruthy()
  })

  it('renders every row with its state copy, description, and server summary', () => {
    renderRegion()
    expect(screen.getByText('atlas')).toBeTruthy()
    // Three rows derive 'unconfigured' (atlas and the tokenless google, dropbox).
    expect(screen.getAllByText('Unconfigured')).toHaveLength(3)
    expect(screen.getByText('Notion workspace')).toBeTruthy()
    // github reads two servers; slack's one is down, so its suffix shows.
    expect(screen.getByText('2 servers')).toBeTruthy()
    expect(screen.getByText('1 server · not mounted')).toBeTruthy()
    expect(screen.getByText('the mount was refused')).toBeTruthy()
    // A row without a recorded lastError shows no error copy of its own.
    expect(screen.queryByText('Jira project')).toBeTruthy()
  })

  it('offers configure on an unconfigured token row, connect on a ready row, and nothing on an authorizing row', () => {
    const a = renderRegion()
    // Roster order: atlas (Configure), notion (Connect), github (Disconnect),
    // slack (Connect retry), jira (Connect retry), m365 (none), google (none),
    // dropbox (none).
    expect(screen.getByRole('button', { name: 'Configure' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()

    // The authorizing row is mid-flow: its name sits in a button-free row.
    expect(screen.getAllByRole('button')).toHaveLength(5 + 8)

    // A tokenless unconfigured row has no action; its howTo guides instead.
    expect(screen.getByText('Run the provider setup.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    expect(a.openTokenDialog).toHaveBeenCalledWith('atlas')
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]!)
    expect(a.connect).toHaveBeenCalledWith('notion', 'token')
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[1]!)
    expect(a.connect).toHaveBeenCalledWith('slack', 'token')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(a.disconnect).toHaveBeenCalledWith('github')
  })

  it('disables the row actions while its operation is in flight', () => {
    renderRegion({ busyId: 'notion' })
    // Every row action shares the busy gate: with one operation in flight
    // no row action is enabled, on any row. The provider select buttons
    // are not gated (they only switch the view, they don't mutate).
    const actionButtons = screen.getAllByRole('button').filter(b => !b.className.includes('providerRow'))
    expect(actionButtons).toHaveLength(5)
    for (const button of actionButtons) expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('renders a row operation failure under its row', () => {
    renderRegion({ opError: { id: 'notion', message: 'no flow engine' } })
    expect(screen.getByText('no flow engine')).toBeTruthy()
  })

  it('renders the rail as one expanding link icon', () => {
    const a = renderRegion({}, { wide: false })
    const icon = screen.getByRole('button', { name: 'Connectors' })
    expect(icon).toBeTruthy()
    fireEvent.click(icon)
    expect(a.expandSidebar).toHaveBeenCalledOnce()
  })

  it('drives the token dialog end to end: one field per reference, guard, save, adopt the view', async () => {
    const { connectors } = await renderDriven()
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Connect atlas')).toBeTruthy()
    expect(within(dialog).getByText('Create a token in your dashboard.')).toBeTruthy()
    // One secret field per declared reference, labeled by its name.
    expect(within(dialog).getByText('ATLASSIAN_USERNAME')).toBeTruthy()
    expect(within(dialog).getByText('ATLASSIAN_TOKEN')).toBeTruthy()
    const [usernameInput, tokenInput] = within(dialog).getAllByPlaceholderText('Paste your token') as [HTMLInputElement, HTMLInputElement]
    // An incomplete draft cannot save: only the first reference is filled.
    expect(within(dialog).queryByRole('button', { name: 'Save & connect' })?.hasAttribute('disabled')).toBe(true)
    fireEvent.change(usernameInput, { target: { value: 'me' } })
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Save & connect' })?.hasAttribute('disabled')).toBe(true)
    })
    fireEvent.change(tokenInput, { target: { value: 'sekrit' } })
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Save & connect' })?.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(connectors.configure).toHaveBeenCalledWith({
      id: 'atlas',
      fields: { credentials: { ATLASSIAN_USERNAME: 'me', ATLASSIAN_TOKEN: 'sekrit' } },
    })
    // The response view was adopted: the row now reads connected.
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('shows the saving label and closes through the footer cancel while the save runs', async () => {
    let resolve: (value: unknown) => void = () => {}
    const pending = new Promise((value) => { resolve = value })
    const { controller } = await renderDriven({
      configure: () => pending,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    const dialog = screen.getByRole('dialog')
    const [usernameInput, tokenInput] = within(dialog).getAllByPlaceholderText('Paste your token') as [HTMLInputElement, HTMLInputElement]
    fireEvent.change(usernameInput, { target: { value: 'me' } })
    fireEvent.change(tokenInput, { target: { value: 'sekrit' } })
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Save & connect' })?.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeTruthy()
    })
    expect(within(dialog).queryByRole('button', { name: 'Saving…' })?.hasAttribute('disabled')).toBe(true)
    // The footer cancel (text, not the icon close button) dismisses the draft.
    const cancel = within(dialog).getAllByRole('button', { name: 'Cancel' })
      .find(button => button.textContent === 'Cancel')!
    fireEvent.click(cancel)
    resolve(okView())
    await waitFor(() => {
      expect(controller.store.getSnapshot().dialog).toBeNull()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a failed save under the field, cleared by the next edit', async () => {
    await renderDriven({
      configure: async () => ({ rpcId: 'r', result: { ok: false as const, error: { code: 'connector-unavailable', message: 'store refused' } } }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    const dialog = screen.getByRole('dialog')
    const [usernameInput, tokenInput] = within(dialog).getAllByPlaceholderText('Paste your token') as [HTMLInputElement, HTMLInputElement]
    fireEvent.change(usernameInput, { target: { value: 'me' } })
    fireEvent.change(tokenInput, { target: { value: 'sekrit' } })
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Save & connect' })?.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => {
      expect(within(dialog).getByText('store refused')).toBeTruthy()
    })
    // The next edit clears the failure.
    fireEvent.change(tokenInput, { target: { value: 'sekrit2' } })
    await waitFor(() => {
      expect(within(dialog).queryByText('store refused')).toBeNull()
    })
  })

  it('leaves the dialog descriptionless when the token method has no howTo', async () => {
    await renderDriven({}, view({
      id: 'linear',
      description: 'Linear workspace',
      state: 'unconfigured',
      auth: [{ mode: 'token', configured: false, credentialRefs: ['LINEAR_API_TOKEN'] }],
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Connect linear')).toBeTruthy()
    // A single-reference method renders its one field labeled by the ref name.
    expect(within(dialog).getByText('LINEAR_API_TOKEN')).toBeTruthy()
    expect(within(dialog).getAllByPlaceholderText('Paste your token')).toHaveLength(1)
    // No howTo, no description paragraph under the title.
    expect(within(dialog).queryByText('Create a token in your dashboard.')).toBeNull()
  })
})
