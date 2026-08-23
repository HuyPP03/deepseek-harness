/**
 * The region controller: roster reads, response adoption, the token dialog,
 * and the row actions — all over a fake connector api, no wire.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConnectorView, IApiClient, RpcId, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { ConnectorsSectionController } from '../src/client/controller.ts'

/** One secret-free roster view; `with` overrides the interesting fields. */
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

const TOKEN_UNCONFIGURED = view({
  id: 'atlas',
  state: 'unconfigured',
  auth: [{
    mode: 'token', configured: false, howTo: 'Create a token in your dashboard.',
    credentialRefs: ['ATLASSIAN_USERNAME', 'ATLASSIAN_TOKEN'],
  }],
})

const TOKEN_CONFIGURED = view({
  id: 'notion',
  state: 'needs-auth',
  auth: [{ mode: 'token', configured: true }],
})

const TOKEN_NO_HOWTO = view({
  id: 'linear',
  state: 'unconfigured',
  auth: [{ mode: 'token', configured: false, credentialRefs: ['LINEAR_API_TOKEN'] }],
})

const OAUTH_ONLY = view({
  id: 'google',
  state: 'unconfigured',
  auth: [{ mode: 'oauth', configured: false, howTo: 'Run the provider setup.' }],
})

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: 'r' as RpcId, result: { ok: true as const, value } }
}

function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: 'r' as RpcId, result: { ok: false as const, error: { code: 'connector-unavailable', message, details: {} } } }
}

/** The four wire calls the controller drives, typed by the real domain. */
type ConnectorDouble = Pick<IApiClient['connectors'], 'list' | 'configure' | 'connect' | 'disconnect'>

function fakeConnectors(overrides: Partial<ConnectorDouble> = {}) {
  // The fakes answer the RpcResponse shapes the controller unwraps; the
  // domain signatures (request payloads, signals) are test-irrelevant.
  const base: ConnectorDouble = {
    list: vi.fn(async () => ok({ connectors: [TOKEN_UNCONFIGURED, TOKEN_CONFIGURED, OAUTH_ONLY, TOKEN_NO_HOWTO] })),
    configure: vi.fn(async (payload: { id: string }) => ok({ connector: view({ id: payload.id, state: 'connected', auth: [{ mode: 'token', configured: true }] }) })),
    connect: vi.fn(async (payload: { id: string }) => ok({ connector: view({ id: payload.id, state: 'connected' }) })),
    disconnect: vi.fn(async (payload: { id: string }) => ok({ connector: view({ id: payload.id, state: 'unconfigured', auth: [{ mode: 'token', configured: false }] }) })),
  }
  return { ...base, ...overrides }
}

/** The connection service's api double: only the connector domain matters. */
function fakeApi(connectors: Partial<ConnectorDouble> = {}) {
  return { connectors: fakeConnectors(connectors) }
}

/** Mount the controller over the roster, loaded and ready. */
async function ready(connectors: Partial<ConnectorDouble> = {}) {
  const api = fakeApi(connectors)
  const controller = new ConnectorsSectionController(api)
  await controller.load()
  return { controller, api }
}

describe('ConnectorsSectionController', () => {
  it('reads the roster into a copy on success', async () => {
    const { controller } = await ready()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.connectors.map(c => c.id)).toEqual(['atlas', 'notion', 'google', 'linear'])
    expect(state.connectors).not.toHaveLength(0)
  })

  it('keeps the roster read error as a page-level failure', async () => {
    const { controller } = await ready({
      list: async () => fail('roster down'),
    })
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('roster down')
  })

  it('treats an empty roster as a valid deployment', async () => {
    const { controller } = await ready({
      list: async () => ok({ connectors: [] }),
    })
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.connectors).toEqual([])
  })

  it('opens the token dialog only for an unconfigured token method', async () => {
    const { controller } = await ready()
    expect(controller.store.getSnapshot().dialog).toBeNull()

    controller.openTokenDialog('atlas')
    let dialog = controller.store.getSnapshot().dialog
    expect(dialog).toMatchObject({
      id: 'atlas', name: 'atlas',
      howTo: 'Create a token in your dashboard.',
      // One empty draft per declared reference, in the method's order.
      drafts: { ATLASSIAN_USERNAME: '', ATLASSIAN_TOKEN: '' },
      saving: false, error: null,
    })
    // A token method without instructions opens with a null guidance.
    controller.openTokenDialog('linear')
    dialog = controller.store.getSnapshot().dialog
    expect(dialog).toMatchObject({ id: 'linear', howTo: null, drafts: { LINEAR_API_TOKEN: '' } })

    controller.closeDialog()
    // A configured token row and a tokenless row have no dialog.
    controller.openTokenDialog('notion')
    expect(controller.store.getSnapshot().dialog).toBeNull()
    controller.openTokenDialog('google')
    expect(controller.store.getSnapshot().dialog).toBeNull()
    // An unknown id never reaches the dialog either.
    controller.openTokenDialog('nope')
    expect(controller.store.getSnapshot().dialog).toBeNull()
    expect(controller.store.getSnapshot().dialog).not.toBe(dialog)
  })

  it('patches one reference draft at a time and clears its previous failure', async () => {
    const { controller } = await ready()
    controller.openTokenDialog('atlas')
    controller.setDialogDraft('ATLASSIAN_USERNAME', 'me')
    let dialog = controller.store.getSnapshot().dialog
    expect(dialog?.drafts).toEqual({ ATLASSIAN_USERNAME: 'me', ATLASSIAN_TOKEN: '' })
    controller.setDialogDraft('ATLASSIAN_TOKEN', 'sekrit')
    dialog = controller.store.getSnapshot().dialog
    expect(dialog?.drafts).toEqual({ ATLASSIAN_USERNAME: 'me', ATLASSIAN_TOKEN: 'sekrit' })

    // A closed dialog swallows drafts.
    controller.closeDialog()
    controller.setDialogDraft('ATLASSIAN_USERNAME', 'ignored')
    expect(controller.store.getSnapshot().dialog).toBeNull()
  })

  it('saves the drafts per reference and adopts the response view, closing the dialog', async () => {
    const { controller, api } = await ready()
    controller.openTokenDialog('atlas')
    controller.setDialogDraft('ATLASSIAN_USERNAME', 'me')
    controller.setDialogDraft('ATLASSIAN_TOKEN', 'sekrit')
    await controller.saveToken()
    expect(api.connectors.configure).toHaveBeenCalledWith({
      id: 'atlas',
      fields: { credentials: { ATLASSIAN_USERNAME: 'me', ATLASSIAN_TOKEN: 'sekrit' } },
    })
    const state = controller.store.getSnapshot()
    expect(state.dialog).toBeNull()
    expect(state.connectors.find(c => c.id === 'atlas')?.auth).toEqual([{ mode: 'token', configured: true }])
  })

  it('keeps the dialog open over its drafts when the save fails', async () => {
    const { controller } = await ready({
      configure: async () => fail('store refused'),
    })
    controller.openTokenDialog('atlas')
    controller.setDialogDraft('ATLASSIAN_TOKEN', 'sekrit')
    await controller.saveToken()
    const dialog = controller.store.getSnapshot().dialog
    expect(dialog).toMatchObject({
      drafts: { ATLASSIAN_USERNAME: '', ATLASSIAN_TOKEN: 'sekrit' },
      saving: false, error: 'store refused',
    })
    // The next edit clears the failure.
    controller.setDialogDraft('ATLASSIAN_TOKEN', 'sekrit2')
    expect(controller.store.getSnapshot().dialog?.error).toBeNull()
  })

  it('guards a second save while one is in flight', async () => {
    let resolve: (value: unknown) => void = () => {}
    const pending = new Promise((value) => { resolve = value })
    const { controller, api } = await ready({
      configure: vi.fn(() => pending) as unknown as ConnectorDouble['configure'],
    })
    controller.openTokenDialog('atlas')
    controller.setDialogDraft('ATLASSIAN_TOKEN', 'sekrit')
    const saving = controller.saveToken()
    void controller.saveToken()
    resolve(ok({ connector: view({ id: 'atlas', state: 'connected' }) }))
    await saving
    expect(api.connectors.configure).toHaveBeenCalledOnce()
  })

  it('connects and adopts the response view', async () => {
    const { controller, api } = await ready()
    await controller.connect('notion')
    expect(api.connectors.connect).toHaveBeenCalledWith({ id: 'notion', mode: 'token' })
    expect(controller.store.getSnapshot().connectors.find(c => c.id === 'notion')?.state).toBe('connected')
    expect(controller.store.getSnapshot().busyId).toBeNull()
  })

  it('records a connect failure on its row', async () => {
    const { controller } = await ready({
      connect: async () => fail('no flow engine'),
    })
    await controller.connect('notion')
    const state = controller.store.getSnapshot()
    expect(state.opError).toEqual({ id: 'notion', message: 'no flow engine' })
    // The next operation on the row clears it.
    await controller.disconnect('notion')
    expect(controller.store.getSnapshot().opError).toBeNull()
  })

  it('records a disconnect failure on its row', async () => {
    const { controller } = await ready({
      disconnect: async () => fail('the mount is still draining'),
    })
    await controller.disconnect('atlas')
    expect(controller.store.getSnapshot().opError).toEqual({
      id: 'atlas',
      message: 'the mount is still draining',
    })
    expect(controller.store.getSnapshot().busyId).toBeNull()
  })

  it('disconnects and adopts the response view', async () => {
    const { controller, api } = await ready()
    await controller.disconnect('atlas')
    expect(api.connectors.disconnect).toHaveBeenCalledWith({ id: 'atlas' })
    expect(controller.store.getSnapshot().connectors.find(c => c.id === 'atlas')?.state).toBe('unconfigured')
  })

  it('guards a second operation while one is in flight', async () => {
    let resolve: (value: unknown) => void = () => {}
    const pending = new Promise((value) => { resolve = value })
    const { controller, api } = await ready({
      connect: vi.fn(() => pending) as unknown as ConnectorDouble['connect'],
    })
    void controller.connect('atlas')
    void controller.connect('atlas')
    void controller.disconnect('atlas')
    resolve(ok({ connector: view({ id: 'atlas', state: 'connected' }) }))
    expect(controller.store.getSnapshot().dialog).toBeNull()
    expect(api.connectors.connect).toHaveBeenCalledOnce()
    expect(api.connectors.disconnect).not.toHaveBeenCalled()
  })

  it('drops a mutation response for a roster that never loaded', async () => {
    const api = fakeApi()
    const controller = new ConnectorsSectionController(api)
    await controller.connect('atlas')
    expect(controller.store.getSnapshot().connectors).toEqual([])
  })
})
