// @vitest-environment jsdom
/**
 * The connectors directory's rendering rules: which message a status shows,
 * which action a state offers, the risk notes the cards derive, the provider
 * detail's session list, and the token dialog's field, guard, and error
 * display.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore, type SessionListState, type SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ConnectorsDirectory } from '../src/client/ConnectorsDirectory.tsx'
import type { ConnectorsDirectoryProps } from '../src/client/contract/slots.ts'
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
  view({ id: 'atlas', description: 'Atlassian Cloud', state: 'unconfigured', auth: [{ mode: 'token', configured: false, howTo: 'Create a token.', credentialRefs: ['ATLASSIAN_TOKEN'] }] }),
  view({ id: 'notion', description: 'Notion workspace', state: 'needs-auth', auth: [{ mode: 'token', configured: true, credentialRefs: ['NOTION_TOKEN'] }] }),
  view({ id: 'github', description: 'GitHub account', state: 'connected', servers: [{ serverName: 'github', mounted: true, status: 'connected', tools: ['create_issue', 'list_repos'] }, { serverName: 'gh-mirror', mounted: true, status: 'connected', tools: ['list_repos', 'search_code'] }] }),
  view({ id: 'slack', description: 'Slack workspace', state: 'connected', servers: [{ serverName: 'slack', mounted: true, status: 'connected', tools: ['post_message'] }] }),
  view({ id: 'jira', description: 'Jira project', state: 'error' }),
  view({ id: 'google', description: 'Google Drive', state: 'needs-auth', auth: [{ mode: 'oauth', configured: false, howTo: 'Run the provider setup.' }] }),
  view({ id: 'dropbox', description: 'Dropbox account', state: 'unconfigured', auth: [{ mode: 'oauth', configured: false, howTo: 'Add the Dropbox app in the provider console.' }] }),
  view({ id: 'm365', description: 'Microsoft 365', state: 'authorizing', custom: true }),
  view({ id: 'linear', description: 'Linear workspace', state: 'needs-auth', auth: [{ mode: 'device', configured: false }] }),
]

const READY: ConnectorsSectionState = {
  status: 'ready',
  error: null,
  connectors: ROSTER,
  selectedProvider: null,
  providerTools: [],
  busyId: null,
  opError: null,
  dialog: null,
  oauthDialog: null,
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

function renderDirectory(
  state: Partial<ConnectorsSectionState> = {},
  options: {
    sessions?: SessionListState
    deviceLoginResult?: { status: 'device-code' | 'ready'; verificationUri?: string; userCode?: string; message?: string; expiresAt: number }
    failFlows?: boolean
  } = {},
) {
  const store = createSnapshotStore<ConnectorsSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    openTokenDialog: vi.fn(),
    setDialogDraft: vi.fn(),
    closeDialog: vi.fn(),
    saveToken: vi.fn(() => Promise.resolve()),
    openOauthDialog: vi.fn(),
    setOauthDraft: vi.fn(),
    closeOauthDialog: vi.fn(),
    saveOauth: vi.fn(() => Promise.resolve()),
    connect: vi.fn(() => Promise.resolve()),
    authorize: vi.fn(() => options.failFlows
      ? Promise.reject(new Error('no browser'))
      : Promise.resolve({ authorizationUrl: 'http://127.0.0.1:8766/authorize', expiresAt: Date.now() + 300_000 })),
    deviceLogin: vi.fn(() => options.failFlows
      ? Promise.reject(new Error('device flow unavailable'))
      : Promise.resolve(options.deviceLoginResult ?? { status: 'ready' as const, expiresAt: Date.now() })),
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
    t: (key: string, params?: Record<string, unknown>) =>
      (en as Record<string, string>)[key]!.replace(
        /\{(\w+)}/g, (m, name: string) => (name in (params ?? {}) ? String(params?.[name]) : m),
      ),
    useConnectors: bindSnapshotSelector(store),
    ...actions,
    // A real hook binding (the renderer's own mechanism), not a plain
    // selector call: a conditionally called useSessions must trip React's
    // hook-order check in the test exactly as it does in the browser.
    useSessions: bindSnapshotSelector(createSnapshotStore(options.sessions ?? SESSIONS)),
  }
  const viewApi = render(<ConnectorsDirectory {...(props as unknown as ConnectorsDirectoryProps)} />)
  return { ...actions, view: viewApi }
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

/** The driven byoApp row: an unconfigured pre-registered-app method. */
const BYOAPP_ROW = view({
  id: 'gmail',
  description: 'Gmail',
  state: 'unconfigured',
  auth: [{ mode: 'oauth', configured: false, byoApp: true, setupGuide: ['Create a Google Cloud project.', 'Register a desktop app.'] }],
})

function okView() {
  return { rpcId: 'r', result: { ok: true as const, value: { connector: DRIVEN_CONNECTED } } }
}

/**
 * The OAuth app dialog's credential inputs in DOM order: the client id text field, then the
 * optional secret password field. A password input is not role-addressable, so the inputs are
 * read by their type attribute.
 */
function dialogInputs(dialog: HTMLElement): [HTMLInputElement, HTMLInputElement | undefined] {
  const inputs = Array.from(dialog.querySelectorAll('input'))
  return [inputs.find(input => input.type === 'text')!, inputs.find(input => input.type === 'password')]
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
async function renderDriven(
  overrides: DrivenWireOverrides = {},
  rows: readonly ConnectorView[] = [DRIVEN_ROW],
  sessions: SessionListState = SESSIONS,
) {
  const connectors = {
    list: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connectors: [...rows] } } })),
    configure: vi.fn(async () => okView()),
    connect: vi.fn(async () => okView()),
    disconnect: vi.fn(async () => okView()),
    add: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { id: 'custom' } } })),
    remove: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: {} } })),
    ...overrides,
  }
  const controller = new ConnectorsSectionController({ connectors } as never)
  const props = {
    t: (key: string, params?: Record<string, unknown>) =>
      (en as Record<string, string>)[key]!.replace(
        /\{(\w+)}/g, (m, name: string) => (name in (params ?? {}) ? String(params?.[name]) : m),
      ),
    useConnectors: bindSnapshotSelector(controller.store),
    useSessions: bindSnapshotSelector(createSnapshotStore(sessions)),
    load: () => controller.load(),
    openTokenDialog: (id: string) => { controller.openTokenDialog(id) },
    setDialogDraft: (ref: string, value: string) => { controller.setDialogDraft(ref, value) },
    closeDialog: () => { controller.closeDialog() },
    saveToken: () => controller.saveToken(),
    openOauthDialog: (id: string) => { controller.openOauthDialog(id) },
    setOauthDraft: (field: 'clientId' | 'clientSecret', value: string) => { controller.setOauthDraft(field, value) },
    closeOauthDialog: () => { controller.closeOauthDialog() },
    saveOauth: () => controller.saveOauth(),
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
  const viewApi = render(<ConnectorsDirectory {...(props as unknown as ConnectorsDirectoryProps)} />)
  await waitFor(() => {
    expect(controller.store.getSnapshot().status).toBe('ready')
  })
  return { connectors, controller, view: viewApi }
}

describe('ConnectorsDirectory', () => {
  it('reads the roster on mount and shows the loading message until ready', () => {
    const a = renderDirectory({ status: 'loading', connectors: [] })
    expect(a.load).toHaveBeenCalledOnce()
    expect(screen.getByText('Loading connectors…')).toBeTruthy()
  })

  it('shows the read failure with a retry that re-reads', () => {
    const a = renderDirectory({ status: 'error', error: 'roster down', connectors: [] })
    expect(screen.getByText('roster down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(a.load).toHaveBeenCalledTimes(2)
  })

  it('shows the empty state for a deployment with no connectors', () => {
    renderDirectory({ status: 'ready', connectors: [] })
    expect(screen.getByText('No connectors are composed on this deployment.')).toBeTruthy()
  })

  it('renders every card with its state copy, description, and server summary', () => {
    renderDirectory()
    expect(screen.getByText('atlas')).toBeTruthy()
    // Two cards derive 'unconfigured' (atlas and the tokenless dropbox);
    // google sits in needs-auth with its browser sign-in pending.
    expect(screen.getAllByText('Unconfigured')).toHaveLength(2)
    expect(screen.getByText('Notion workspace')).toBeTruthy()
    // github reads two servers; slack's one is mounted, so no suffix.
    expect(screen.getByText('2 servers')).toBeTruthy()
    expect(screen.getByText('1 server')).toBeTruthy()
    // A card without a recorded lastError shows no error copy of its own.
    expect(screen.getByText('Jira project')).toBeTruthy()
  })

  it('derives the risk notes from the card view', () => {
    renderDirectory()
    // atlas: an unconfigured token method names the credential reference.
    expect(screen.getByText('Requires ATLASSIAN_TOKEN — an invalid or revoked token fails the connect.')).toBeTruthy()
    // notion: a stored token can still be revoked.
    expect(screen.getByText('Uses the stored NOTION_TOKEN — a revoked token drops the servers.')).toBeTruthy()
    // google and dropbox: the browser sign-in grant can expire (one line each).
    expect(screen.getAllByText('Needs a browser sign-in — the grant can expire and needs re-authorization.')).toHaveLength(2)
    // linear: the manual device code expires quickly.
    expect(screen.getByText('Needs a manual code entry in the browser — the code expires quickly.')).toBeTruthy()
    // m365: a custom connector's server must stay reachable.
    expect(screen.getByText('Custom connector — its server must stay reachable.')).toBeTruthy()
    // A fully mounted connected card has no risk lines at all.
    expect(screen.queryByText(/not mounted/)).toBeNull()
  })

  it('offers configure on an unconfigured token card, connect on a ready card, and nothing on an authorizing card', () => {
    const a = renderDirectory()
    // Roster order: atlas (Configure), notion (Connect token), github
    // (Disconnect), slack (Disconnect), jira (Connect retry), google
    // (Connect oauth), dropbox (Connect oauth), m365 (Remove), linear
    // (Connect device).
    expect(screen.getByRole('button', { name: 'Configure' })).toBeTruthy()
    // needs-auth (notion, google, linear), failed-mount (jira), and the
    // unconfigured browser flows (google, dropbox) all offer Connect.
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(5)
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2)

    // The authorizing card is mid-flow: its name sits in a button-free card.
    expect(screen.getAllByRole('button')).toHaveLength(1 + 5 + 2 + 9 + 1 + 1)

    // A tokenless unconfigured card has no action; its howTo guides instead
    // (dropbox; google's howTo no longer shows — its card is needs-auth).
    expect(screen.getByText('Add the Dropbox app in the provider console.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    expect(a.openTokenDialog).toHaveBeenCalledWith('atlas')
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]!)
    expect(a.connect).toHaveBeenCalledWith('notion', 'token')
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[0]!)
    expect(a.disconnect).toHaveBeenCalledWith('github')
  })

  it('starts the browser OAuth flow from its card and opens the authorization url', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      const a = renderDirectory()
      // Connect order follows the roster: notion (0), jira (1), google (2),
      // dropbox (3), linear (4).
      fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[2]!)
      await waitFor(() => {
        expect(a.authorize).toHaveBeenCalledWith('google')
      })
      await waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith('http://127.0.0.1:8766/authorize', '_blank', 'noopener,noreferrer')
      })
    } finally {
      openSpy.mockRestore()
    }
  })

  it('starts the device-code flow from its card and opens the verification uri', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      const a = renderDirectory({}, {
        deviceLoginResult: {
          status: 'device-code', verificationUri: 'https://device.example/code', userCode: 'ABCD-1234', expiresAt: Date.now() + 600_000,
        },
      })
      fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[4]!)
      await waitFor(() => {
        expect(a.deviceLogin).toHaveBeenCalledWith('linear')
      })
      await waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith('https://device.example/code', '_blank', 'noopener,noreferrer')
      })
    } finally {
      openSpy.mockRestore()
    }
  })

  it('opens the device code page only when the flow carries a verification uri', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      const a = renderDirectory({}, {
        deviceLoginResult: { status: 'device-code', userCode: 'ABCD-1234', expiresAt: Date.now() + 600_000 },
      })
      fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[4]!)
      await waitFor(() => {
        expect(a.deviceLogin).toHaveBeenCalledWith('linear')
      })
      await waitFor(() => {
        expect(a.deviceLogin).toHaveBeenCalledTimes(1)
      })
      expect(openSpy).not.toHaveBeenCalled()
    } finally {
      openSpy.mockRestore()
    }
  })

  it('selects and opens on Enter, and ignores other keys, on the card and session-row wrappers', () => {
    const grid = renderDirectory()
    fireEvent.keyDown(screen.getByRole('button', { name: /github/ }), { key: 'Escape' })
    expect(grid.selectProvider).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('button', { name: /github/ }), { key: 'Enter' })
    expect(grid.selectProvider).toHaveBeenCalledWith('github')
    const detail = renderDirectory({ selectedProvider: 'github' })
    fireEvent.keyDown(screen.getAllByRole('button', { name: /GitHub chat/ })[0]!, { key: 'Escape' })
    expect(detail.openSession).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getAllByRole('button', { name: /GitHub chat/ })[0]!, { key: 'Enter' })
    expect(detail.openSession).toHaveBeenCalledWith('s4')
  })

  it('swallows a rejected browser or device flow without crashing the view', async () => {
    const a = renderDirectory({}, { failFlows: true })
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[2]!)
    await waitFor(() => {
      expect(a.authorize).toHaveBeenCalledWith('google')
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[4]!)
    await waitFor(() => {
      expect(a.deviceLogin).toHaveBeenCalledWith('linear')
    })
    // The rejections settle into the swallowed catches: the grid still renders.
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /github/ })).toBeTruthy()
    })
  })

  it('does not open a window for a device code without a verification uri', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      const a = renderDirectory({}, { deviceLoginResult: { status: 'device-code', expiresAt: Date.now() } })
      fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[4]!)
      await waitFor(() => {
        expect(a.deviceLogin).toHaveBeenCalledWith('linear')
      })
      await vi.waitFor(() => {
        expect(openSpy).not.toHaveBeenCalled()
      })
    } finally {
      openSpy.mockRestore()
    }
  })

  it('shows the empty note for a selected provider the roster does not carry', () => {
    renderDirectory({ selectedProvider: 'ghost' })
    expect(screen.getByText('No connectors are composed on this deployment.')).toBeTruthy()
  })

  it('selects a provider through its card and opens the custom dialog from the header', () => {
    const a = renderDirectory()
    fireEvent.click(screen.getByRole('button', { name: /github/ }))
    expect(a.selectProvider).toHaveBeenCalledWith('github')
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
    expect(a.openCustomDialog).toHaveBeenCalledOnce()
  })

  it('opens the connect flow a card click needs: dialog, oauth, device, token, and the settling select', () => {
    const a = renderDirectory()
    // An unconfigured token method opens the token dialog.
    fireEvent.click(screen.getByRole('button', { name: /^atlas/ }))
    expect(a.openTokenDialog).toHaveBeenCalledWith('atlas')
    // A needs-auth token method (the token stored) connects.
    fireEvent.click(screen.getByRole('button', { name: /notion/ }))
    expect(a.connect).toHaveBeenCalledWith('notion', 'token')
    // A failed mount retries the connect.
    fireEvent.click(screen.getByRole('button', { name: /jira/ }))
    expect(a.connect).toHaveBeenLastCalledWith('jira', 'token')
    // An unconfigured browser sign-in starts the OAuth flow.
    fireEvent.click(screen.getByRole('button', { name: /dropbox/ }))
    expect(a.authorize).toHaveBeenCalledWith('dropbox')
    // A needs-auth device method starts the device-code flow.
    fireEvent.click(screen.getByRole('button', { name: /linear/ }))
    expect(a.deviceLogin).toHaveBeenCalledWith('linear')
    // A settling mount opens its detail instead of re-starting a flow.
    fireEvent.click(screen.getByRole('button', { name: /m365/ }))
    expect(a.selectProvider).toHaveBeenCalledWith('m365')
  })

  it('offers Set up app on an unconfigured byoApp card instead of Connect, and Connect once the client id is stored', () => {
    const a = renderDirectory({
      connectors: [
        BYOAPP_ROW,
        view({ id: 'gcal', description: 'Google Calendar', state: 'needs-auth', auth: [{ mode: 'oauth', configured: true, byoApp: true }] }),
        view({ id: 'gdrive', description: 'Google Drive', state: 'connected', auth: [{ mode: 'oauth', configured: true, byoApp: true }] }),
      ],
    })
    // The unconfigured byoApp card offers Set up app, not Connect (the flow
    // cannot start before the client id is stored).
    const gmailCard = screen.getByRole('button', { name: /Gmail/ })
    expect(within(gmailCard).getByRole('button', { name: 'Set up app' })).toBeTruthy()
    expect(within(gmailCard).queryByRole('button', { name: 'Connect' })).toBeNull()
    // A stored client id (needs-auth) and a live mount (connected) offer
    // Connect, not Set up app.
    const gcalCard = screen.getByRole('button', { name: /Google Calendar/ })
    expect(within(gcalCard).getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(within(gcalCard).queryByRole('button', { name: 'Set up app' })).toBeNull()
    const gdriveCard = screen.getByRole('button', { name: /Google Drive/ })
    expect(within(gdriveCard).queryByRole('button', { name: 'Set up app' })).toBeNull()
    // Card click and inner button both open the OAuth app dialog; the inner
    // button stops the propagation so the card click does not run twice.
    fireEvent.click(gmailCard)
    expect(a.openOauthDialog).toHaveBeenCalledTimes(1)
    a.openOauthDialog.mockClear()
    fireEvent.click(within(gmailCard).getByRole('button', { name: 'Set up app' }))
    expect(a.openOauthDialog).toHaveBeenCalledTimes(1)
    expect(a.openOauthDialog).toHaveBeenLastCalledWith('gmail')
  })

  it('disables the card actions while its operation is in flight', () => {
    renderDirectory({ busyId: 'notion' })
    // Every card action shares the busy gate: with one operation in flight
    // no card action is enabled, on any card. The provider select wrappers
    // are not gated (they only switch the view, they don't mutate). The New
    // connector header is not gated either. The custom card's Remove sits
    // outside the busy gate: filter it out here.
    const actionButtons = screen.getAllByRole('button').filter(b => !b.className.includes('card') && b.textContent !== 'New connector' && b.textContent !== 'Remove')
    expect(actionButtons).toHaveLength(8)
    for (const button of actionButtons) expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('renders a card operation failure under its card', () => {
    renderDirectory({ opError: { id: 'notion', message: 'no flow engine' } })
    expect(screen.getByText('no flow engine')).toBeTruthy()
  })

  it('lists the connected provider\'s own chats: preset-filtered, blank hidden, latest first', () => {
    const a = renderDirectory({ selectedProvider: 'github' })
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

  it('lists the real tool names the connected provider exposes, not the server names', () => {
    renderDirectory({
      selectedProvider: 'github',
      providerTools: ['create_issue', 'list_repos', 'search_code'],
    })
    expect(screen.getByText(en['tools.available'])).toBeTruthy()
    expect(screen.getByText('create_issue')).toBeTruthy()
    expect(screen.getByText('list_repos')).toBeTruthy()
    expect(screen.getByText('search_code')).toBeTruthy()
    // The server names are not the tool list.
    expect(screen.queryByText('gh-mirror')).toBeNull()
  })

  it('opens a chat through its row and mints one through New chat', () => {
    const a = renderDirectory({ selectedProvider: 'github' })
    // The rows are latest first, so the first row is s4 (the newer chat).
    fireEvent.click(screen.getAllByRole('button', { name: /GitHub chat/ })[0]!)
    expect(a.openSession).toHaveBeenCalledWith('s4')
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(a.newProviderChat).toHaveBeenCalledWith('github')
  })

  it('keeps the placeholder for an unconnected provider and the empty note when it has no chats', () => {
    // jira is not connected: the placeholder stands.
    const a = renderDirectory({ selectedProvider: 'jira' })
    expect(a.view.getByText('Sessions for this provider will appear here once a connector session is created.')).toBeTruthy()
    // github is connected but has no chats of its own.
    const b = renderDirectory({ selectedProvider: 'github' }, { sessions: EMPTY_SESSIONS })
    expect(b.view.getByText('No chats for this provider yet.')).toBeTruthy()
    expect(b.view.getByRole('button', { name: 'New chat' })).toBeTruthy()
  })

  it('keeps a stable hook order while the provider detail toggles (React #310 regression)', async () => {
    // The list → detail → list → detail transitions mount and unmount the
    // provider's session branch. A session hook that ran only inside the
    // detail branch changed the hook count across these renders and crashed
    // the whole slot with "Rendered more hooks than during the previous
    // render"; the hook must run on every render.
    const { controller } = await renderDriven({}, ROSTER)
    controller.selectProvider('github')
    await waitFor(() => { expect(screen.getByText('GitHub chat newer')).toBeTruthy() })
    controller.selectProvider(null)
    await waitFor(() => { expect(screen.getByText('Notion workspace')).toBeTruthy() })
    controller.selectProvider('github')
    await waitFor(() => { expect(screen.getByText('GitHub chat newer')).toBeTruthy() })
    // Switching providers keeps the branch mounted: only the data moves.
    controller.selectProvider('slack')
    await waitFor(() => { expect(screen.getByText('Slack chat')).toBeTruthy() })
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
    // The response view was adopted: the card now reads connected.
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

  it('offers Set up app on an unconfigured byoApp card instead of Connect', () => {
    renderDirectory({
      connectors: [
        BYOAPP_ROW,
        view({ id: 'gcal', description: 'Google Calendar', state: 'needs-auth', auth: [{ mode: 'oauth', configured: true, byoApp: true }] }),
        view({ id: 'gdrive', description: 'Google Drive', state: 'connected', servers: [{ serverName: 'drive', mounted: true, status: 'connected' }], auth: [{ mode: 'oauth', configured: true, byoApp: true }] }),
      ],
    })
    // The unconfigured byoApp card offers Set up app, not Connect: the flow
    // cannot start before the client id is stored.
    const gmailCard = screen.getByRole('button', { name: /Gmail/ })
    expect(within(gmailCard).getByRole('button', { name: 'Set up app' })).toBeTruthy()
    expect(within(gmailCard).queryByRole('button', { name: 'Connect' })).toBeNull()
    // The client id stored (needs-auth) offers Connect again.
    const gcalCard = screen.getByRole('button', { name: /Google Calendar/ })
    expect(within(gcalCard).getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(within(gcalCard).queryByRole('button', { name: 'Set up app' })).toBeNull()
    // A live byoApp mount offers no set-up action at all.
    const gdriveCard = screen.getByRole('button', { name: /Google Drive/ })
    expect(within(gdriveCard).queryByRole('button', { name: 'Set up app' })).toBeNull()
  })

  it('opens the OAuth app dialog from a byoApp card click and its Set up app button', () => {
    const a = renderDirectory({ connectors: [BYOAPP_ROW] })
    const card = screen.getByRole('button', { name: /Gmail/ })
    fireEvent.click(card)
    expect(a.openOauthDialog).toHaveBeenCalledWith('gmail')
    // The inner button stops the propagation: its click opens the dialog
    // once, without re-running the card click.
    a.openOauthDialog.mockClear()
    fireEvent.click(within(card).getByRole('button', { name: 'Set up app' }))
    expect(a.openOauthDialog).toHaveBeenCalledOnce()
  })

  it('drives the OAuth app dialog: the setup steps, the client id guard, the optional secret', async () => {
    const { connectors, controller } = await renderDriven({
      configure: vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: { connector: view({ id: 'gmail', description: 'Gmail', state: 'connected', auth: [{ mode: 'oauth', configured: true }] }) } } })),
    }, [BYOAPP_ROW])
    fireEvent.click(screen.getByRole('button', { name: 'Set up app' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Set up your gmail app')).toBeTruthy()
    expect(within(dialog).getByText('Create a Google Cloud project.')).toBeTruthy()
    expect(within(dialog).getByText('Register a desktop app.')).toBeTruthy()
    expect(within(dialog).getByText('Optional — leave empty when your provider gives you a public desktop client.')).toBeTruthy()
    // The client id is the plain text field; the untouched secret is the
    // password field (read by type: a password input is not role-addressable).
    const [idInput] = dialogInputs(dialog)
    // An empty client id cannot save.
    expect(within(dialog).queryByRole('button', { name: 'Save' })?.hasAttribute('disabled')).toBe(true)
    fireEvent.change(idInput, { target: { value: '123.apps' } })
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Save' })?.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    // The untouched secret is omitted from the wire fields.
    expect(connectors.configure).toHaveBeenCalledWith({ id: 'gmail', fields: { clientId: '123.apps' } })
    expect(controller.store.getSnapshot().connectors.find(c => c.id === 'gmail')?.state).toBe('connected')
  })

  it('sends the drafted secret, shows a failed save under the fields, and cancels over the draft', async () => {
    const { connectors, controller } = await renderDriven({
      configure: vi.fn(async () => ({ rpcId: 'r', result: { ok: false as const, error: { code: 'connector-unavailable', message: 'client id unknown' } } })),
    }, [BYOAPP_ROW])
    fireEvent.click(screen.getByRole('button', { name: 'Set up app' }))
    const dialog = screen.getByRole('dialog')
    const [idInput, secretInput] = dialogInputs(dialog)
    fireEvent.change(idInput, { target: { value: '123.apps' } })
    fireEvent.change(secretInput!, { target: { value: 'shh' } })
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Save' })?.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(within(dialog).getByText('client id unknown')).toBeTruthy()
    })
    expect(connectors.configure).toHaveBeenCalledWith({ id: 'gmail', fields: { clientId: '123.apps', clientSecret: 'shh' } })
    // The failure keeps the dialog open over its drafts; cancel discards it.
    expect(screen.getByRole('dialog')).toBeTruthy()
    const cancel = within(dialog).getAllByRole('button', { name: 'Cancel' })
      .find(button => button.textContent === 'Cancel')!
    fireEvent.click(cancel)
    await waitFor(() => {
      expect(controller.store.getSnapshot().oauthDialog).toBeNull()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the saving label while the OAuth save runs', async () => {
    let resolve: (value: unknown) => void = () => {}
    const pending = new Promise((value) => { resolve = value })
    const { controller } = await renderDriven({ configure: () => pending }, [BYOAPP_ROW])
    fireEvent.click(screen.getByRole('button', { name: 'Set up app' }))
    const dialog = screen.getByRole('dialog')
    const [idInput] = within(dialog).getAllByRole('textbox') as [HTMLInputElement]
    fireEvent.change(idInput, { target: { value: '123.apps' } })
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Save' })?.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeTruthy()
    })
    expect(within(dialog).getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
    // The footer cancel dismisses the draft while the save is still in flight.
    const cancel = within(dialog).getAllByRole('button', { name: 'Cancel' })
      .find(button => button.textContent === 'Cancel')!
    fireEvent.click(cancel)
    resolve({ rpcId: 'r', result: { ok: true as const, value: { connector: view({ id: 'gmail', description: 'Gmail', state: 'connected', auth: [{ mode: 'oauth', configured: true }] }) } } })
    await waitFor(() => {
      expect(controller.store.getSnapshot().oauthDialog).toBeNull()
    })
  })

  it('omits the setup steps when the byoApp method carries none', async () => {
    await renderDriven({}, [view({
      id: 'gmail',
      description: 'Gmail',
      state: 'unconfigured',
      auth: [{ mode: 'oauth', configured: false, byoApp: true }],
    })])
    fireEvent.click(screen.getByRole('button', { name: 'Set up app' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Create a Google Cloud project.')).toBeNull()
    expect(within(dialog).getByRole('textbox')).toBeTruthy()
  })

  it('leaves the dialog descriptionless when the token method has no howTo', async () => {
    await renderDriven({}, [view({
      id: 'linear',
      description: 'Linear workspace',
      state: 'unconfigured',
      auth: [{ mode: 'token', configured: false, credentialRefs: ['LINEAR_API_TOKEN'] }],
    })])
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
