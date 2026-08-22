// @vitest-environment jsdom
/**
 * ui-model-selection browser half on a real cordis Context with fake command/slots/
 * connection faces and real session scopes: the plugin mounts ModelDirectoryResolver
 * as `models`, the /model contribution, the /effort decoration, and the
 * conversation.input.model seat all register, and every entry resolves the SAME
 * per-session directory through the service — a selection submitted through any
 * entry is the current the others' next options pass marks active,
 * the one-shared-state contract of the triple entry.
 * Scope disposal drops the directory (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelProviderGroup, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandContribution, CommandDecoration, CommandPopupSelectSpec, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ModelSelectInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

// The composer-block assertions read zh copy from the initial locale, so the
// spec states the browser it assumes.
usePinnedBrowserLanguages('zh-CN')

const sid = (k: string): SessionId => k as SessionId

const GROUPS = [{
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
  ],
}]

/** Boot the plugin over fake faces + a stateful fake host (current moves on selectModel). */
async function bench() {
  const ctx = new Context()
  let current: ModelSelection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  let groups: ModelProviderGroup[] = GROUPS
  const calls = { models: 0, select: 0 }
  ctx.provide('connection', { api: { sessions: {
    models: () => {
      calls.models += 1
      return Promise.resolve({
        result: { ok: true as const, value: { current, routable, groups, failures: [] } },
      })
    },
    selectModel: (payload: { provider: string; model: string; reasoningEffort?: string }) => {
      calls.select += 1
      current = {
        provider: payload.provider,
        model: payload.model,
        ...payload.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: payload.reasoningEffort },
      }
      return Promise.resolve({ result: { ok: true as const, value: { selected: current } } })
    },
  } } })
  // Whether the Host reports an adapter for the current route; the composer
  // block follows this, never catalog membership.
  let routable = true
  const blocks = new Map<SessionId, { reason: string } | undefined>()
  ctx.provide('conversation', {
    blocks: {
      set: (id: SessionId, block: { reason: string } | undefined) => { blocks.set(id, block) },
    },
  })
  let contribution: CommandContribution | undefined
  let decoration: CommandDecoration | undefined
  ctx.provide('commandUi', {
    register(c: CommandContribution) {
      contribution = c
      return () => { contribution = undefined }
    },
    decorate(d: CommandDecoration) {
      decoration = d
      return () => { decoration = undefined }
    },
  })
  const seats = new Map<string, {
    inject: ((sessionId: SessionId) => ModelSelectInjected) | undefined
    locale: string | undefined
  }>()
  ctx.provide('slots', {
    inject(_name: string, callback: () => () => void) { return callback() },
    register(options: { name: string; locale?: string; inject?: (sessionId: SessionId) => ModelSelectInjected }) {
      seats.set(options.name, { inject: options.inject, locale: options.locale })
      return () => { seats.delete(options.name) }
    },
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const scopes = new Map<SessionId, Context>()
  const addressed = new Set<SessionId>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    subagentAddress: (id: SessionId) => addressed.has(id)
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
  })
  new TestRemote(ctx)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await ctx.plugin(function probe() {}).await()
  const mint = (key: string) => {
    const handle = createScope(ctx, sid(key))
    scopes.set(sid(key), handle.ctx)
    return handle
  }
  return {
    ctx, fiber, mint, calls,
    contribution: () => contribution as (CommandContribution & { ui: CommandPopupSelectSpec }),
    decoration: () => decoration as (CommandDecoration & { ui: CommandPopupSelectSpec }),
    seat: () => seats.get('conversation.input.model')!,
    hostCurrent: () => current,
    setHostCurrent: (selection: ModelSelection) => { current = selection },
    setGroups: (next: ModelProviderGroup[]) => { groups = next },
    address: (id: SessionId) => { addressed.add(id) },
    setRoutable: (next: boolean) => { routable = next },
    blockOf: (key: string) => blocks.get(sid(key)),
  }
}

const projection = (id: string) => ({ sessionId: sid(id) })

describe('ui-model-selection dual entry', () => {
  it('registers the /model contribution and the composer model seat', async () => {
    const b = await bench()
    expect(b.contribution().name).toBe('model')
    expect(b.contribution().ui.kind).toBe('popupSelect')
    expect(b.seat().inject).toBeTypeOf('function')
    // Copy rides the standard locale seat.
    expect(b.seat().locale).toBe('model')
  })

  it('popup options mark the host current active with the provider group in the detail', async () => {
    const b = await bench()
    b.mint('s1')
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    expect(options.map((o: SelectOption) => o.label)).toEqual(['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro'])
    expect(options[0]).toMatchObject({ active: true, detail: 'DeepSeek' })
    expect(options[1]?.active).toBeUndefined()
  })

  it('a seat selection is the current the popup marks active next — one shared state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    // Switch through the SEAT entry.
    expect(await seatFace.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })).toBe(true)
    expect(b.hostCurrent()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    expect(seatFace.directory.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    // The POPUP's next options pass reflects it without a seat-side reload.
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    expect(options.find((o: SelectOption) => o.label === 'DeepSeek-V4-Pro')).toMatchObject({ active: true })
  })

  it('a popup selection lands on the seat store — the reverse direction of the same state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    const pro = options.find((o: SelectOption) => o.label === 'DeepSeek-V4-Pro')!
    await b.contribution().ui.onSelect(pro, projection('s1'))
    expect(seatFace.directory.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
    })
  })

  it('the /effort decoration registers on the host command with a popupSelect', async () => {
    const b = await bench()
    expect(b.decoration().name).toBe('effort')
    expect(b.decoration().ui.kind).toBe('popupSelect')
  })

  it('the /effort popup lists the current model efforts, marking the effective one active', async () => {
    const b = await bench()
    b.mint('s1')
    // No explicit effort: the model default ('high') is the effective row.
    let options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options.map((o: SelectOption) => o.label)).toEqual(['Off', 'High', 'Max'])
    expect(options[1]).toMatchObject({ active: true })
    expect(options[0]?.active).toBeUndefined()
    expect(options[2]?.active).toBeUndefined()
    // The model names a default effort, so no provider-default row exists.
    expect(options.some((o: SelectOption) => o.id === 'provider-default')).toBe(false)

    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' })
    options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options.find((o: SelectOption) => o.id === 'max')).toMatchObject({ active: true })
    expect(options.find((o: SelectOption) => o.id === 'high')?.active).toBeUndefined()
  })

  it('offers a provider-default row only when the model names no default effort', async () => {
    const b = await bench()
    b.mint('s1')
    b.setGroups([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        reasoning: { efforts: [{ id: 'low', name: 'Low', description: 'Lowest' }, { id: 'high', name: 'High' }] },
      }],
    }])
    // No explicit effort: the provider-default row is the active one.
    let options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options).toEqual([
      { id: 'provider-default', label: 'Default', active: true },
      { id: 'low', label: 'Low', detail: 'Lowest' },
      { id: 'high', label: 'High' },
    ])
    // An explicit effort: the effort row is active, the default row is not.
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' })
    options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options).toEqual([
      { id: 'provider-default', label: 'Default' },
      { id: 'low', label: 'Low', detail: 'Lowest', active: true },
      { id: 'high', label: 'High' },
    ])
  })

  it('answers a model without reasoning metadata with an empty popup', async () => {
    const b = await bench()
    b.mint('s1')
    b.setHostCurrent({ provider: 'deepseek-official', model: 'no-reasoning' })
    const options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options).toEqual([])
  })

  it('a /effort popup pick submits the same model with the picked effort through selectModel', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    const options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    await b.decoration().ui.onSelect(options.find((o: SelectOption) => o.id === 'max')!, projection('s1'))
    expect(b.hostCurrent()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
    // The shared directory reflects the switch for the other entries.
    expect(seatFace.directory.getSnapshot().current).toMatchObject({ model: 'deepseek-v4-flash', reasoningEffort: 'max' })
  })

  it('a /effort provider-default pick clears the explicit effort from the selection', async () => {
    const b = await bench()
    b.mint('s1')
    b.setGroups([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
      }],
    }])
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' })
    const options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    await b.decoration().ui.onSelect(options.find((o: SelectOption) => o.id === 'provider-default')!, projection('s1'))
    expect(b.hostCurrent()).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('refuses a /effort pick before the directory has loaded', async () => {
    const b = await bench()
    b.mint('s1')
    await expect(b.decoration().ui.onSelect({ id: 'off', label: 'Off' }, projection('s1')))
      .rejects.toThrow('the model directory has not loaded yet')
  })

  it('withholds the /effort decoration from addressed subagent sessions', async () => {
    const b = await bench()
    b.mint('child')
    b.address(sid('child'))
    expect(b.decoration().available(projection('child'))).toBe(false)
    await expect(b.decoration().ui.options(projection('child'), new AbortController().signal))
      .rejects.toThrow('model selection is unavailable for addressed subagent sessions')
    await expect(b.decoration().ui.onSelect({ id: 'off', label: 'Off' }, projection('child')))
      .rejects.toThrow('model selection is unavailable for addressed subagent sessions')
  })

  it('both entries share one directory instance per session, isolated across sessions', async () => {
    const b = await bench()
    b.mint('a')
    b.mint('b')
    const faceA = b.seat().inject!(sid('a'))
    const faceA2 = b.seat().inject!(sid('a'))
    const faceB = b.seat().inject!(sid('b'))
    expect(faceA.directory).toBe(faceA2.directory)
    expect(faceA.directory).not.toBe(faceB.directory)
    // The service face resolves the same instance the seat inject handed out.
    expect(b.ctx.modelDirectories.directoryFor(sid('a')).store).toBe(faceA.directory)
  })

  it('drops an unconsumed local selection and restores the Host target after reconnect', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await face.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    b.ctx.emit('connection/reset')
    expect(face.directory.getSnapshot()).toMatchObject({ current: null, status: 'loading' })
    await Promise.resolve()
    expect(face.directory.getSnapshot()).toMatchObject({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      status: 'ready',
    })
  })

  it('scope disposal drops the directory; a reborn scope gets a fresh one', async () => {
    const b = await bench()
    const first = b.mint('s1')
    const face1 = b.seat().inject!(sid('s1'))
    await first.fiber.dispose()
    b.mint('s1')
    const face2 = b.seat().inject!(sid('s1'))
    expect(face2.directory).not.toBe(face1.directory)
  })

  it('blocks the composer only once the Host reports the route unservable', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))

    // Before the first load nothing is known. `null` is not `false`: a slow
    // or unreachable Host must never lock a working composer.
    expect(b.blockOf('s1')).toBeUndefined()
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()

    b.setRoutable(false)
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')?.reason).toBe(zh['blocked.composer'])

    // Recovering clears it without a reload of the surface.
    b.setRoutable(true)
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 1])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('never blocks on catalog membership alone', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    // A model the route serves but no longer advertises: the seat prompts for
    // a selection, the composer stays usable. Blocking here would break a
    // supported configuration (a narrowed `models` list over a live route).
    b.setHostCurrent({ provider: 'deepseek-official', model: 'unlisted' })
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    const snapshot = face.directory.getSnapshot()
    expect(snapshot.groups.flatMap(group => group.models.map(model => model.id))).not.toContain('unlisted')
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('clears its block when the session scope goes', async () => {
    const b = await bench()
    const scope = b.mint('s1')
    b.setRoutable(false)
    const face = b.seat().inject!(sid('s1'))
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeDefined()

    await scope.fiber.dispose()
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('an unknown session fails loud at the seat inject', async () => {
    const b = await bench()
    expect(() => b.seat().inject!(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('withholds both model entries from addressed subagent sessions without Agent-bound RPCs', async () => {
    const b = await bench()
    b.mint('child')
    b.address(sid('child'))

    expect(b.contribution().available(projection('child'))).toBe(false)
    await expect(b.contribution().ui.options(
      projection('child'),
      new AbortController().signal,
    )).rejects.toThrow(/unavailable for addressed subagent/)

    const face = b.seat().inject!(sid('child'))
    expect(face.available).toBe(false)
    face.load()
    await expect(face.select({ provider: 'deepseek', model: 'deepseek-v4-pro' })).resolves.toBe(false)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).load())
      .rejects.toThrow(/unavailable for addressed subagent/)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).select({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })).rejects.toThrow(/unavailable for addressed subagent/)
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.calls).toEqual({ models: 0, select: 0 })
  })
})
