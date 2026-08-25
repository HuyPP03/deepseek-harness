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

const BYOAPP = view({
  id: 'gmail',
  state: 'unconfigured',
  auth: [{ mode: 'oauth', configured: false, byoApp: true, setupGuide: ['Create a Google Cloud project.', 'Register a desktop app.'] }],
})

const BYOAPP_CONFIGURED = view({
  id: 'gcal',
  state: 'needs-auth',
  auth: [{ mode: 'oauth', configured: true, byoApp: true }],
})

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: 'r' as RpcId, result: { ok: true as const, value } }
}

function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: 'r' as RpcId, result: { ok: false as const, error: { code: 'connector-unavailable', message, details: {} } } }
}

/** The four wire calls the controller drives, typed by the real domain. */
type ConnectorDouble = Pick<IApiClient['connectors'], 'list' | 'configure' | 'connect' | 'disconnect' | 'authorize' | 'deviceLogin' | 'add' | 'remove'>

function fakeConnectors(overrides: Partial<ConnectorDouble> = {}) {
  // The fakes answer the RpcResponse shapes the controller unwraps; the
  // domain signatures (request payloads, signals) are test-irrelevant.
  const base: ConnectorDouble = {
    list: vi.fn(async () => ok({
      connectors: [TOKEN_UNCONFIGURED, TOKEN_CONFIGURED, OAUTH_ONLY, TOKEN_NO_HOWTO, BYOAPP, BYOAPP_CONFIGURED],
    })),
    configure: vi.fn(async (payload: { id: string }) => ok({ connector: view({ id: payload.id, state: 'connected', auth: [{ mode: 'token', configured: true }] }) })),
    connect: vi.fn(async (payload: { id: string }) => ok({ connector: view({ id: payload.id, state: 'connected' }) })),
    authorize: vi.fn(async () => ok({ authorizationUrl: 'http://127.0.0.1:8766/authorize', expiresAt: Date.now() + 300_000 })),
    deviceLogin: vi.fn(async () => ok({ status: 'ready' as const, expiresAt: Date.now() })),
    add: vi.fn(async () => ok({ id: 'custom' })),
    remove: vi.fn(async () => ok({})),
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
  it('resolves a provider preset id from the roster, absent for an unknown id', async () => {
    const { controller } = await ready()
    expect(controller.providerPresetId('atlas')).toBe('preset')
    expect(controller.providerPresetId('unknown')).toBeUndefined()
  })

  it('reads the roster into a copy on success', async () => {
    const { controller } = await ready()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.connectors.map(c => c.id)).toEqual(['atlas', 'notion', 'google', 'linear', 'gmail', 'gcal'])
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

  it('single-flights the roster read: a concurrent second read joins the first', async () => {
    let resolveList: (value: unknown) => void = () => {}
    const api = fakeApi({
      list: vi.fn(() => new Promise((resolve) => { resolveList = resolve })) as unknown as ConnectorDouble['list'],
    })
    const controller = new ConnectorsSectionController(api)
    const first = controller.load()
    const second = controller.load()
    // Both callers wait on the same in-flight read; the host sees one call.
    expect((api.connectors.list as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
    expect(second).toBe(first)
    resolveList({ rpcId: 'r', result: { ok: true as const, value: { connectors: [TOKEN_UNCONFIGURED] } } })
    await first
    await second
    expect(controller.store.getSnapshot().status).toBe('ready')
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

  it('opens the OAuth app dialog only for an unconfigured byoApp method', async () => {
    const { controller } = await ready()

    controller.openOauthDialog('gmail')
    expect(controller.store.getSnapshot().oauthDialog).toMatchObject({
      id: 'gmail', name: 'gmail',
      setupGuide: ['Create a Google Cloud project.', 'Register a desktop app.'],
      clientId: '', clientSecret: '', saving: false, error: null,
    })
    controller.closeOauthDialog()
    expect(controller.store.getSnapshot().oauthDialog).toBeNull()

    // The guards: a configured byoApp row, a non-byoApp oauth row, a
    // tokenless-of-oauth row, and an unknown id all have no dialog.
    controller.openOauthDialog('gcal')
    expect(controller.store.getSnapshot().oauthDialog).toBeNull()
    controller.openOauthDialog('google')
    expect(controller.store.getSnapshot().oauthDialog).toBeNull()
    controller.openOauthDialog('atlas')
    expect(controller.store.getSnapshot().oauthDialog).toBeNull()
    controller.openOauthDialog('nope')
    expect(controller.store.getSnapshot().oauthDialog).toBeNull()
  })

  it('patches one OAuth draft field at a time and guards the closed dialog', async () => {
    const { controller } = await ready()
    // The closed dialog swallows drafts and closes.
    controller.setOauthDraft('clientId', 'orphan')
    controller.closeOauthDialog()
    expect(controller.store.getSnapshot().oauthDialog).toBeNull()

    controller.openOauthDialog('gmail')
    controller.setOauthDraft('clientId', '  ')
    controller.setOauthDraft('clientSecret', 'shh')
    expect(controller.store.getSnapshot().oauthDialog).toMatchObject({ clientId: '  ', clientSecret: 'shh' })
    controller.setOauthDraft('clientId', 'abc.apps')
    expect(controller.store.getSnapshot().oauthDialog).toMatchObject({ clientId: 'abc.apps', clientSecret: 'shh', error: null })
  })

  it('saves the client id alone when the secret is empty and adopts the response view', async () => {
    const { controller, api } = await ready()
    controller.openOauthDialog('gmail')
    controller.setOauthDraft('clientId', ' 123.apps ')
    await controller.saveOauth()
    expect(api.connectors.configure).toHaveBeenCalledWith({ id: 'gmail', fields: { clientId: '123.apps' } })
    const snapshot = controller.store.getSnapshot()
    expect(snapshot.oauthDialog).toBeNull()
    expect(snapshot.connectors.find(c => c.id === 'gmail')?.state).toBe('connected')
  })

  it('sends the client secret when one is drafted', async () => {
    const { controller, api } = await ready()
    controller.openOauthDialog('gmail')
    controller.setOauthDraft('clientId', '123.apps')
    controller.setOauthDraft('clientSecret', 'shh')
    await controller.saveOauth()
    expect(api.connectors.configure).toHaveBeenCalledWith({ id: 'gmail', fields: { clientId: '123.apps', clientSecret: 'shh' } })
  })

  it('keeps the OAuth dialog open over its drafts when the save fails, and a next edit clears it', async () => {
    const { controller } = await ready({
      configure: async (payload: { id: string }) => payload.id === 'gmail'
        ? fail('the client id is not registered')
        : ok({ connector: view({ id: payload.id, state: 'connected' }) }),
    })
    controller.openOauthDialog('gmail')
    controller.setOauthDraft('clientId', '123.apps')
    await controller.saveOauth()
    const draft = controller.store.getSnapshot().oauthDialog
    expect(draft).toMatchObject({ clientId: '123.apps', saving: false, error: 'the client id is not registered' })
    controller.setOauthDraft('clientId', '456.apps')
    expect(controller.store.getSnapshot().oauthDialog?.error).toBeNull()
  })

  it('guards the OAuth save while empty or in flight', async () => {
    let resolve: (value: unknown) => void = () => {}
    const pending = new Promise((value) => { resolve = value })
    const { controller, api } = await ready({
      configure: vi.fn(() => pending) as unknown as ConnectorDouble['configure'],
    })
    // A closed dialog and an empty client id both save nothing.
    await controller.saveOauth()
    controller.openOauthDialog('gmail')
    await controller.saveOauth()
    expect(api.connectors.configure).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().oauthDialog?.saving).toBe(false)

    controller.setOauthDraft('clientId', '123.apps')
    const saving = controller.saveOauth()
    void controller.saveOauth()
    resolve(ok({ connector: view({ id: 'gmail', state: 'connected' }) }))
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

  it('authorizes and returns the browser flow facts, failing loud on a rejected flow', async () => {
    const { controller, api } = await ready()
    const facts = await controller.authorize('google')
    expect(api.connectors.authorize).toHaveBeenCalledWith({ id: 'google' })
    expect(facts.authorizationUrl).toBe('http://127.0.0.1:8766/authorize')
    expect(facts.expiresAt).toBeGreaterThan(Date.now())
    const failing = await ready({ authorize: async () => fail('no browser available') })
    await expect(failing.controller.authorize('google')).rejects.toThrow('no browser available')
  })

  it('device-logins and returns the code facts, failing loud on a rejected flow', async () => {
    const { controller, api } = await ready()
    const facts = await controller.deviceLogin('google')
    expect(api.connectors.deviceLogin).toHaveBeenCalledWith({ id: 'google' })
    expect(facts.status).toBe('ready')
    const coding = await ready({
      deviceLogin: async () => ok({ status: 'device-code' as const, verificationUri: 'http://127.0.0.1:8766/device', userCode: 'ABCD-1234', expiresAt: Date.now() + 600_000 }),
    })
    expect((await coding.controller.deviceLogin('google')).userCode).toBe('ABCD-1234')
    const failing = await ready({ deviceLogin: async () => fail('device flow unavailable') })
    await expect(failing.controller.deviceLogin('google')).rejects.toThrow('device flow unavailable')
  })

  it('guards the custom dialog mutators and the close while the dialog is closed', () => {
    const { controller } = { controller: new ConnectorsSectionController(fakeApi()) }
    controller.setCustomDraft('name', 'ghost')
    expect(controller.store.getSnapshot().customDialog).toBeNull()
    controller.closeCustomDialog()
    expect(controller.store.getSnapshot().customDialog).toBeNull()
  })

  it('closes the open custom dialog and discards its draft', () => {
    const { controller } = { controller: new ConnectorsSectionController(fakeApi()) }
    controller.openCustomDialog()
    controller.setCustomDraft('name', 'draft')
    controller.closeCustomDialog()
    expect(controller.store.getSnapshot().customDialog).toBeNull()
  })

  it('guards a second saveCustom while the first is in flight', async () => {
    let resolveAdd: (value: unknown) => void = () => {}
    const api = fakeApi({
      add: vi.fn(() => new Promise((resolve) => { resolveAdd = resolve })) as unknown as ConnectorDouble['add'],
    })
    const controller = new ConnectorsSectionController(api)
    controller.openCustomDialog()
    controller.setCustomDraft('name', 'pending')
    controller.setCustomDraft('command', 'npx')
    void controller.saveCustom()
    void controller.saveCustom()
    expect(api.connectors.add).toHaveBeenCalledOnce()
    resolveAdd(ok({ id: 'x' }))
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().customDialog).toBeNull()
    })
  })

  it('carries the id, trims empty args segments, and drops the header flag on stdio', async () => {
    const { controller, api } = await ready()
    controller.openCustomDialog()
    controller.setCustomDraft('name', 'With Id')
    controller.setCustomDraft('id', 'with-id')
    controller.setCustomDraft('command', 'npx')
    controller.setCustomDraft('args', '-y, @acme/mcp, ,')
    await controller.saveCustom()
    expect(api.connectors.add).toHaveBeenCalledWith({
      spec: { name: 'With Id', id: 'with-id', transport: 'stdio', command: 'npx', args: ['-y', '@acme/mcp'] },
    })
    // A stdio draft without args sends no args key at all.
    controller.openCustomDialog()
    controller.setCustomDraft('name', 'Bare')
    controller.setCustomDraft('command', 'npx')
    await controller.saveCustom()
    expect(api.connectors.add).toHaveBeenLastCalledWith({
      spec: { name: 'Bare', transport: 'stdio', command: 'npx' },
    })
    // A stdio draft with a token var sends the var, no header flag.
    controller.openCustomDialog()
    controller.setCustomDraft('name', 'Tokened')
    controller.setCustomDraft('command', 'npx')
    controller.setCustomDraft('tokenVar', 'SERVICE_TOKEN')
    await controller.saveCustom()
    expect(api.connectors.add).toHaveBeenLastCalledWith({
      spec: { name: 'Tokened', transport: 'stdio', command: 'npx', tokenVar: 'SERVICE_TOKEN' },
    })
  })

  it('keeps tokenVar without the header flag on a stdio draft', async () => {
    const { controller, api } = await ready()
    controller.openCustomDialog()
    controller.setCustomDraft('name', 'Tokened Stdio')
    controller.setCustomDraft('command', 'npx')
    controller.setCustomDraft('tokenVar', 'MY_SERVICE_TOKEN')
    await controller.saveCustom()
    expect(api.connectors.add).toHaveBeenCalledWith({
      spec: { name: 'Tokened Stdio', transport: 'stdio', command: 'npx', tokenVar: 'MY_SERVICE_TOKEN' },
    })
  })

  it('sends tokenVarIsHeader false on an http draft without the flag', async () => {
    const { controller, api } = await ready()
    controller.openCustomDialog()
    controller.setCustomDraft('name', 'Remote')
    controller.setCustomDraft('transport', 'streamable-http')
    controller.setCustomDraft('url', 'https://mcp.example.com')
    controller.setCustomDraft('tokenVar', 'AUTHORIZATION')
    await controller.saveCustom()
    expect(api.connectors.add).toHaveBeenCalledWith({
      spec: { name: 'Remote', transport: 'streamable-http', url: 'https://mcp.example.com', tokenVar: 'AUTHORIZATION', tokenVarIsHeader: false },
    })
  })

  it('guards a remove while an operation is in flight and records a remove failure', async () => {
    let resolveConnect: (value: unknown) => void = () => {}
    const { controller, api } = await ready({
      connect: vi.fn(() => new Promise((resolve) => { resolveConnect = resolve })) as unknown as ConnectorDouble['connect'],
    })
    void controller.connect('notion')
    await controller.removeCustom('atlas')
    expect(api.connectors.remove).not.toHaveBeenCalled()
    resolveConnect(ok({ connector: view({ id: 'notion', state: 'connected' }) }))
    const failing = await ready({ remove: async () => fail('manifest missing') })
    await failing.controller.removeCustom('atlas')
    expect(failing.controller.store.getSnapshot().opError).toEqual({ id: 'atlas', message: 'manifest missing' })
    expect(failing.controller.store.getSnapshot().busyId).toBeNull()
  })

  it('clears the selection when the removed row was selected and keeps the roster', async () => {
    const { controller } = await ready()
    controller.selectProvider('atlas')
    await controller.removeCustom('atlas')
    expect(controller.store.getSnapshot().selectedProvider).toBeNull()
    expect(controller.store.getSnapshot().connectors.map(c => c.id)).toEqual(['atlas', 'notion', 'google', 'linear', 'gmail', 'gcal'])
    controller.selectProvider('unknown')
    expect(controller.store.getSnapshot().selectedProvider).toBe('unknown')
    expect(controller.store.getSnapshot().providerTools).toEqual([])
  })

  it('derives the selected provider tool list from the mounted servers, deduped', async () => {
    const { controller } = await ready({
      list: async () => ok({ connectors: [view({
        id: 'atlas',
        servers: [
          { serverName: 'atlas', mounted: true, status: 'connected', tools: ['get_ticket', 'create_ticket'] },
          { serverName: 'atlas-mirror', mounted: true, status: 'connected', tools: ['get_ticket', 'search'] },
          // A mounted server whose view carries no tools yet.
          { serverName: 'atlas-bare', mounted: true, status: 'connected' },
        ],
      })] }),
    })
    controller.selectProvider('atlas')
    expect(controller.store.getSnapshot().providerTools).toEqual(['get_ticket', 'create_ticket', 'search'])
    controller.selectProvider(null)
    expect(controller.store.getSnapshot().providerTools).toEqual([])
  })
})
