// @vitest-environment jsdom
/**
 * The region's rendering rules: which message a status shows, which action a
 * state offers, the rail affordance, and the token dialog's field, guard, and
 * error display.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore, type SessionListState, type SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
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
    // The preset defaults to the id: the provider detail filters the session
    // feed on it, and the roster ids double as preset ids in these tests.
    presetId: withFields.id,
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
  view({ id: 'slack', description: 'Slack workspace', state: 'connected', servers: [{ serverName: 'slack', mounted: true, status: 'connected' }] }),
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
  customDialog: null,
}

/**
 * The static session feed the provider detail reads: one chat under the
 * atlas preset (the driven row's), one blank, and one under another preset
 * (which the provider list must not show).
 */
const EMPTY_SESSIONS: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
}

const SESSIONS: SessionListState = {
  ids: ['s1', 's2', 's3', 's4', 's5'] as unknown as SessionId[],
  byId: {
    // github's two chats: the older one second, so the list order is checked,
    // and one running.
    s1: { id: 's1', displayTitle: 'GitHub chat', running: false, blank: false, agentPreset: 'github', updatedAt: 100 },
    s4: { id: 's4', displayTitle: 'GitHub chat newer', running: true, blank: false, agentPreset: 'github', updatedAt: 200 },
    // a blank and a foreign-preset session the provider list must not show
    s2: { id: 's2', displayTitle: 'Blank', running: false, blank: true, agentPreset: 'github', updatedAt: 300 },
    s3: { id: 's3', displayTitle: 'Other', running: false, blank: false, agentPreset: 'notion', updatedAt: 400 },
    s5: { id: 's5', displayTitle: 'Slack chat', running: false, blank: false, agentPreset: 'slack', updatedAt: 500 },
  } as unknown as Record<SessionId, SessionSummary>,
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
}

function renderRegion(
  state: Partial<ConnectorsSectionState> = {},
  options: { wide?: boolean; sessions?: SessionListState } = {},
) {
  const store = createSnapshotStore<ConnectorsSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    openTokenDialog: vi.fn(),
    setDialogDraft: vi.fn(),
    closeDialog: vi.fn(),
    saveToken: vi.fn(() => Promise.resolve()),
    connect: vi.fn(() => Promise.resolve()),
    authorize: vi.fn(() => Promise.resolve({ authorizationUrl: 'http://127.0.0.1:8766/authorize', expiresAt: Date.now() + 300_000 })),
    deviceLogin: vi.fn(() => Promise.resolve({ status: 'ready' as const, expiresAt: Date.now() })),
    disconnect: vi.fn(() => Promise.resolve()),
    selectProvider: vi.fn(),
    openSession: vi.fn(),
    newProviderChat: vi.fn(() => Promise.resolve()),
    openCustomDialog: vi.fn(),
    setCustomDraft: vi.fn(),
    closeCustomDialog: vi.fn(),
    saveCustom: vi.fn(() => Promise.resolve()),
    removeCustom: vi.fn(() => Promise.resolve()),
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
    useSessions: (selector: (s: SessionListState) => unknown) => selector(options.sessions ?? SESSIONS),
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

/** The wire overrides renderDriven accepts, named because the inline multi-line object type parses incorrectly under the repo's TS. */
type DrivenWireOverrides = Partial<{
  configure: () => Promise<unknown>
  connect: () => Promise<unknown>
  disconnect: () => Promise<unknown>
  add: () => Promise<unknown>
  remove: () => Promise<unknown>
}>

/**
 * Render over a real controller and a fake connector api: the dialog's
 * draft, guard, and failure display are controller facts, so the driven
 * runtime keeps the store and the actions honest.
 */
async function renderDriven(overrides: DrivenWireOverrides = {}, row: ConnectorView = DRIVEN_ROW, sessions: SessionListState = SESSIONS) {
  const connectors = {
    list: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connectors: [row] } } })),
    configure: vi.fn(async () => okView()),
    connect: vi.fn(async () => okView()),
    disconnect: vi.fn(async () => okView()),
    add: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { id: 'custom' } } })),
    remove: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: {} } })),
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
    useSessions: (selector: (s: SessionListState) => unknown) => selector(sessions),
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
    openSession: vi.fn(),
    newProviderChat: vi.fn(() => Promise.resolve()),
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
    // github reads two servers; slack's one is mounted, so no suffix.
    expect(screen.getByText('2 servers')).toBeTruthy()
    expect(screen.getByText('1 server')).toBeTruthy()
    // A row without a recorded lastError shows no error copy of its own.
    expect(screen.queryByText('Jira project')).toBeTruthy()
  })

  it('offers configure on an unconfigured token row, connect on a ready row, and nothing on an authorizing row', () => {
    const a = renderRegion()
    // Roster order: atlas (Configure), notion (Connect), github (Disconnect),
    // slack (Disconnect), jira (Connect retry), m365 (none), google (none),
    // dropbox (none).
    expect(screen.getByRole('button', { name: 'Configure' })).toBeTruthy()
    // needs-auth (notion) and failed-mount (jira) both offer Connect.
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2)

    // The authorizing row is mid-flow: its name sits in a button-free row.
    expect(screen.getAllByRole('button')).toHaveLength(1 + 2 + 2 + 8 + 1 + 1)

    // A tokenless unconfigured row has no action; its howTo guides instead.
    expect(screen.getByText('Run the provider setup.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    expect(a.openTokenDialog).toHaveBeenCalledWith('atlas')
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]!)
    expect(a.connect).toHaveBeenCalledWith('notion', 'token')
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[0]!)
    expect(a.disconnect).toHaveBeenCalledWith('github')
  })

  it('disables the row actions while its operation is in flight', () => {
    renderRegion({ busyId: 'notion' })
    // Every row action shares the busy gate: with one operation in flight
    // no row action is enabled, on any row. The provider select buttons
    // are not gated (they only switch the view, they don't mutate).
    // The New connector header is not gated either.
    // The custom row's Remove sits outside the busy gate: filter it out here.
    const actionButtons = screen.getAllByRole('button').filter(b => !b.className.includes('card') && b.textContent !== 'New connector' && b.textContent !== 'Remove')
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

  it('lists the connected provider\'s own chats: preset-filtered, blank hidden, latest first', () => {
    const a = renderRegion({ selectedProvider: 'github' })
    expect(screen.getByText('github')).toBeTruthy()
    // Both of github's non-blank chats show, latest first; the blank, the
    // foreign-preset, and another provider's chat do not.
    const titles = screen.getAllByRole('button', { name: /GitHub chat/ }).map(b => b.textContent)
    expect(titles).toEqual(['GitHub chat newer', 'GitHub chat'])
    // The blank, the foreign-preset, and another provider's chat do not render.
    expect(screen.queryByText('Blank')).toBeNull()
    expect(screen.queryByText('Other')).toBeNull()
    expect(screen.queryByText('Slack chat')).toBeNull()
    // Back leaves the detail.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(a.selectProvider).toHaveBeenCalledWith(null)
  })

  it('opens a chat through its row and mints one through New chat', () => {
    const a = renderRegion({ selectedProvider: 'github' })
    // The rows are latest first, so the first row is s4 (the newer chat).
    fireEvent.click(screen.getAllByRole('button', { name: /GitHub chat/ })[0]!)
    expect(a.openSession).toHaveBeenCalledWith('s4')
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(a.newProviderChat).toHaveBeenCalledWith('github')
  })

  it('keeps the placeholder for an unconnected provider and the empty note when it has no chats', () => {
    // jira is not connected: the placeholder stands.
    const a = renderRegion({ selectedProvider: 'jira' })
    expect(a.view.getByText('Sessions for this provider will appear here once a connector session is created.')).toBeTruthy()
    // github is connected but has no chats of its own.
    const b = renderRegion({ selectedProvider: 'github' }, { sessions: EMPTY_SESSIONS })
    expect(b.view.getByText('No chats for this provider yet.')).toBeTruthy()
    expect(b.view.getByRole('button', { name: 'New chat' })).toBeTruthy()
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
