// @vitest-environment jsdom
/**
 * The connected-providers list's rendering rules: only the connected
 * providers appear (the browse cards live in the directory), a row selects
 * its provider for the detail, and the rail renders the expanding icon.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ConnectedProvidersList } from '../src/client/ConnectedProvidersList.tsx'
import type { ConnectedProvidersListProps } from '../src/client/contract/slots.ts'
import type { ConnectorsSectionState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import type { ConnectorView } from '@deepseek-ai/dsh-api-remotes/client'

afterEach(cleanup)

function view(withFields: Partial<ConnectorView> & { id: string }): ConnectorView {
  return {
    name: withFields.id,
    description: 'a description',
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
  view({ id: 'github', description: 'GitHub account' }),
  view({ id: 'slack', description: 'Slack workspace', custom: true }),
  view({ id: 'notion', description: 'Notion workspace', state: 'needs-auth' }),
  view({ id: 'atlas', description: 'Atlassian Cloud', state: 'unconfigured', custom: true }),
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

function renderList(
  state: Partial<ConnectorsSectionState> = {},
  options: { wide?: boolean } = {},
) {
  const store = createSnapshotStore<ConnectorsSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    selectProvider: vi.fn(),
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
  const viewApi = render(<ConnectedProvidersList {...(props as unknown as ConnectedProvidersListProps)} />)
  return { ...actions, expandSidebar: props.expandSidebar, view: viewApi }
}

describe('ConnectedProvidersList', () => {
  it('reads the roster on mount and shows the loading message until ready', () => {
    const a = renderList({ status: 'loading', connectors: [] })
    expect(a.load).toHaveBeenCalledOnce()
    expect(screen.getByText('Loading connectors…')).toBeTruthy()
  })

  it('shows the read failure with a retry that re-reads', () => {
    const a = renderList({ status: 'error', error: 'roster down', connectors: [] })
    expect(screen.getByText('roster down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(a.load).toHaveBeenCalledTimes(2)
  })

  it('shows the empty note when nothing is connected', () => {
    renderList({ status: 'ready', connectors: [view({ id: 'notion', state: 'needs-auth' })] })
    expect(screen.getByText('No connected providers yet. The directory in the main area lists what you can connect.')).toBeTruthy()
  })

  it('lists the connected providers only, with a custom badge on its own', () => {
    renderList()
    // github and slack are connected; notion (needs-auth) and atlas
    // (unconfigured) stay in the directory, not here.
    expect(screen.getByText('github')).toBeTruthy()
    expect(screen.getByText('slack')).toBeTruthy()
    expect(screen.queryByText('notion')).toBeNull()
    expect(screen.queryByText('atlas')).toBeNull()
    // The custom badge shows on the connected custom provider only.
    expect(screen.getAllByText('Custom')).toHaveLength(1)
  })

  it('selects the provider through its row (click and Enter)', () => {
    const a = renderList()
    const row = screen.getByRole('button', { name: 'github' })
    fireEvent.click(row)
    expect(a.selectProvider).toHaveBeenCalledWith('github')
    const other = screen.getByRole('button', { name: /slack/ })
    fireEvent.keyDown(other, { key: 'Enter' })
    expect(a.selectProvider).toHaveBeenLastCalledWith('slack')
    // A non-Enter key never selects.
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(a.selectProvider).toHaveBeenCalledTimes(2)
  })

  it('renders the rail as one expanding link icon', () => {
    const a = renderList({}, { wide: false })
    const icon = screen.getByRole('button', { name: 'Connectors' })
    expect(icon).toBeTruthy()
    fireEvent.click(icon)
    expect(a.expandSidebar).toHaveBeenCalledOnce()
  })
})
