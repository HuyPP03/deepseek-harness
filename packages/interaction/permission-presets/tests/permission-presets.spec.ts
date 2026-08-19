import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
// Side-effect type import: pulls the `agent-preset/selected` SessionEventMap
// merge so the switch-ability spec can append it.
import type {} from '@deepseek-ai/dsh-agent-presets'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { ApprovalPolicy, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService, {
  CUSTOM_PRESET, effectivePermissionPreset, PERMISSION_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-permission-presets'
import type { Config } from '@deepseek-ai/dsh-permission-presets'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Writable memory provider for the permission/settings lifecycle specs. */
class MemorySettings extends SettingsProvider {
  readonly doc: Record<string, unknown> = {}
  readonly writable = true

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

async function mounted(options: {
  config?: Config
  bashDefault?: SandboxMode | undefined
  approvalDefault?: ApprovalPolicy | undefined
} = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.provide('shell', {
    sandboxMode: 'bashDefault' in options ? options.bashDefault : 'workspace-write',
    resolve() { throw new Error('permission tests do not execute bash') },
    run() { throw new Error('permission tests do not execute bash') },
    start() { throw new Error('permission tests do not execute bash') },
  })
  ctx.provide('approval', { config: { policy: 'approvalDefault' in options ? options.approvalDefault : 'ask' } })
  await ctx.plugin(PermissionPresetService, options.config ?? {})
  return ctx
}

function freshSession(id: string): Session {
  return Session.create(SessionId(id))
}

async function mountedStore(options: { approvalDefault?: ApprovalPolicy | undefined } = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(MemorySettings)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('permission tests do not execute bash') },
    run() { throw new Error('permission tests do not execute bash') },
    start() { throw new Error('permission tests do not execute bash') },
  })
  ctx.provide('approval', {
    config: { policy: 'approvalDefault' in options ? options.approvalDefault : 'ask' },
  })
  await ctx.plugin(PermissionPresetService, {})
  return ctx
}

describe('effectivePermissionPreset', () => {
  it('folds to the last event, or undefined without one', () => {
    const session = freshSession('sess-fold')
    expect(effectivePermissionPreset(session.events)).toBeUndefined()
    session.append('permission/preset', { preset: 'danger-full-access' })
    session.append('permission/preset', { preset: 'workspace-write' })
    expect(effectivePermissionPreset(session.events)).toBe('workspace-write')
    // The backward scan steps over non-preset events to the latest selection.
    session.append('sandbox/mode', { mode: 'read-only' })
    expect(effectivePermissionPreset(session.events)).toBe('workspace-write')
  })
})

describe('PermissionPresetService', () => {
  it('advertises the preset table in declaration order and resolves bundles', async () => {
    const ctx = await mounted()
    expect(ctx.permissionPresets.names).toEqual(['workspace-write', 'danger-full-access'])
    expect(ctx.permissionPresets.resolve('danger-full-access')).toMatchObject({ sandbox: 'danger-full-access', approval: 'never' })
    expect(() => ctx.permissionPresets.resolve('plan')).toThrow(/unknown preset "plan"/)
  })

  it('accepts a preset bundling the refs-writable mode with its label and description', async () => {
    const ctx = await mounted({ config: {
      presets: {
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
        'write-workspace': { sandbox: 'workspace-refs-write', approval: 'ask', name: 'Write All', description: 'Write inside the workspace and the attached reference projects.' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      },
    } })
    expect(ctx.permissionPresets.names).toEqual(['workspace-write', 'write-workspace', 'danger-full-access'])
    expect(ctx.permissionPresets.resolve('write-workspace')).toMatchObject({ sandbox: 'workspace-refs-write', approval: 'ask', name: 'Write All' })
    const session = freshSession('sess-refs-preset')
    ctx.permissionPresets.set(session, 'write-workspace')
    expect(ctx.permissionPresets.current(session.events)).toBe('write-workspace')
  })

  it('current() derives from the effective knobs: composition defaults hit workspace-write, a switch hits its preset', async () => {
    const ctx = await mounted()
    const session = freshSession('sess-current')
    expect(ctx.permissionPresets.current(session.events)).toBe('workspace-write')
    ctx.permissionPresets.set(session, 'danger-full-access')
    expect(ctx.permissionPresets.current(session.events)).toBe('danger-full-access')
  })

  it('a knob state matching no table entry derives custom — a state, not an error', async () => {
    const ctx = await mounted()
    const session = freshSession('sess-custom')
    session.append('sandbox/mode', { mode: 'read-only' })
    expect(ctx.permissionPresets.current(session.events)).toBe(CUSTOM_PRESET)
    ctx.permissionPresets.set(session, 'danger-full-access')
    expect(ctx.permissionPresets.current(session.events)).toBe('danger-full-access')
    expect(() => ctx.permissionPresets.resolve(CUSTOM_PRESET)).toThrow(/unknown preset/)
  })

  it('composition defaults outside the table still derive custom when an explicit new-session default is configured', async () => {
    const ctx = await mounted({
      approvalDefault: 'never',
      config: { defaultPreset: 'workspace-write' },
    })
    const session = freshSession('sess-defaults-custom')
    expect(ctx.permissionPresets.current(session.events)).toBe(CUSTOM_PRESET)
  })

  it('the fold breaks bundle ties; a stale fold no longer matching falls back to table order', async () => {
    const ctx = await mounted({ config: { presets: {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      agentish: { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    } } })
    const session = freshSession('sess-tie')
    ctx.permissionPresets.set(session, 'agentish')
    expect(ctx.permissionPresets.current(session.events)).toBe('agentish')
    session.append('approval/policy', { policy: 'never' })
    session.append('sandbox/mode', { mode: 'danger-full-access' })
    expect(ctx.permissionPresets.current(session.events)).toBe('danger-full-access')
  })

  it('set() writes through: one preset event plus both knob events', async () => {
    const ctx = await mounted()
    const session = freshSession('sess-set')
    ctx.permissionPresets.set(session, 'danger-full-access')
    expect(session.events.map(e => [e.type, e.data])).toEqual([
      ['permission/preset', { preset: 'danger-full-access' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
      ['approval/policy', { policy: 'never' }],
    ])
  })

  it('set() to the current preset is a no-op when the knobs already match (clicks are not switches)', async () => {
    const ctx = await mounted()
    const session = freshSession('sess-noop')
    ctx.permissionPresets.set(session, 'workspace-write')
    expect(session.events).toHaveLength(0)
  })

  it('re-asserting a preset from a drifted (custom) state re-records the choice and repairs the knob', async () => {
    const ctx = await mounted()
    const session = freshSession('sess-drift')
    ctx.permissionPresets.set(session, 'danger-full-access')
    // Re-selecting from a drifted state records the choice and repairs only
    // the changed knob.
    session.append('sandbox/mode', { mode: 'read-only' })
    ctx.permissionPresets.set(session, 'danger-full-access')
    const tail = session.events.slice(4)
    expect(tail.map(e => [e.type, e.data])).toEqual([
      ['permission/preset', { preset: 'danger-full-access' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
    ])
  })

  it('rejects composition over a non-confining executor at load', async () => {
    await expect(mounted({ bashDefault: undefined }))
      .rejects.toThrow(/does not confine/)
  })

  it('optionOf() presents shipped labels/descriptions, falls back to the raw key, and fixes custom', async () => {
    const ctx = await mounted()
    expect(ctx.permissionPresets.optionOf('danger-full-access')).toEqual({ value: 'danger-full-access', name: 'danger-full-access', description: 'Full file access without approval prompts.' })
    expect(ctx.permissionPresets.optionOf('custom')).toEqual({ value: 'custom', name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' })
    const bare = await mounted({ config: { presets: { plain: { sandbox: 'workspace-write', approval: 'ask' } } } })
    expect(bare.permissionPresets.optionOf('plain')).toEqual({ value: 'plain', name: 'plain' })
    expect(() => ctx.permissionPresets.optionOf('plan')).toThrow(/unknown preset/)
  })

  it('rejects a table entry named custom (reserved for the derived state)', async () => {
    await expect(mounted({ config: { presets: { custom: { sandbox: 'read-only', approval: 'ask' } } } }))
      .rejects.toThrow(/reserved for the derived not-a-preset state/)
  })

  it('requires an explicit default when composition defaults match no preset', async () => {
    await expect(mounted({ approvalDefault: 'never' }))
      .rejects.toThrow(/configure defaultPreset explicitly/)
  })

  it('reads a schema-less approval stand-in as the ask default', async () => {
    const ctx = await mounted({ approvalDefault: undefined })
    const session = freshSession('sess-standin')
    ctx.permissionPresets.set(session, 'workspace-write')
    expect(session.events).toHaveLength(0)
    expect(ctx.permissionPresets.current(session.events)).toBe('workspace-write')
  })
})

describe('new-session default', () => {
  it('pins the current setting into each new session without changing earlier sessions', async () => {
    const ctx = await mountedStore()
    const first = ctx.sessions.create(SessionId('first'))
    expect(first.events.map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'workspace-write' }],
      ['sandbox/mode', { mode: 'workspace-write' }],
      ['approval/policy', { policy: 'ask' }],
    ])

    await ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'danger-full-access',
    })
    expect(ctx.permissionPresets.defaultPreset).toBe('danger-full-access')
    const second = ctx.sessions.create(SessionId('second'))
    expect(ctx.permissionPresets.current(first.events)).toBe('workspace-write')
    expect(ctx.permissionPresets.current(second.events)).toBe('danger-full-access')
    expect(second.events.map(event => event.type)).toEqual([
      'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
  })

  it('preserves a seeded legacy session instead of applying the latest user default', async () => {
    const ctx = await mountedStore()
    await ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'danger-full-access',
    })
    const legacy = freshSession('legacy-source')
    legacy.append('turn/start', { turn: 1 })
    legacy.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const resumed = ctx.sessions.create(SessionId('legacy-resumed'), { seed: legacy.events })
    expect(ctx.permissionPresets.current(resumed.events)).toBe('workspace-write')
    expect(resumed.events.slice(-3).map(event => event.type)).toEqual([
      'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
  })

  it('preserves composition defaults when an empty stored session resumes', async () => {
    const ctx = await mountedStore()
    await ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'danger-full-access',
    })
    const resumed = ctx.sessions.create(SessionId('empty-resumed'), { seed: [] })
    expect(ctx.permissionPresets.current(resumed.events)).toBe('workspace-write')
    expect(resumed.events.map(event => event.type)).toEqual([
      'session/end-seed', 'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
  })

  it('pins sessions that already exist when the service remounts', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('permission tests do not execute bash') },
      run() { throw new Error('permission tests do not execute bash') },
      start() { throw new Error('permission tests do not execute bash') },
    })
    ctx.provide('approval', { config: { policy: 'ask' } })
    const existing = ctx.sessions.create(SessionId('existing-before-permission'))
    expect(existing.events).toEqual([])

    await ctx.plugin(PermissionPresetService, {})
    expect(existing.events.map(event => event.type)).toEqual([
      'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
    expect(ctx.permissionPresets.current(existing.events)).toBe('workspace-write')
  })

  it('fills only missing legacy facts and preserves an unmatched seeded combination', async () => {
    const ctx = await mountedStore()
    const partial = freshSession('partial-source')
    partial.append('sandbox/mode', { mode: 'workspace-write' })
    partial.append('approval/policy', { policy: 'ask' })
    const resumed = ctx.sessions.create(SessionId('partial-resumed'), { seed: partial.events })
    expect(resumed.events.at(-1)).toMatchObject({
      type: 'permission/preset',
      data: { preset: 'workspace-write' },
    })

    const custom = freshSession('custom-source')
    custom.append('sandbox/mode', { mode: 'read-only' })
    custom.append('approval/policy', { policy: 'never' })
    const unmatched = ctx.sessions.create(SessionId('custom-resumed'), { seed: custom.events })
    expect(ctx.permissionPresets.current(unmatched.events)).toBe(CUSTOM_PRESET)
    expect(unmatched.events.at(-1)?.type).toBe('session/end-seed')
  })

  it('materializes ask when a legacy seed and approval stand-in omit the policy', async () => {
    const ctx = await mountedStore({ approvalDefault: undefined })
    const partial = freshSession('approval-fallback-source')
    partial.append('sandbox/mode', { mode: 'workspace-write' })
    const resumed = ctx.sessions.create(SessionId('approval-fallback-resumed'), { seed: partial.events })
    expect(resumed.events.at(-1)).toMatchObject({
      type: 'approval/policy',
      data: { policy: 'ask' },
    })
  })

  it('rejects a stored default outside the configured preset table', async () => {
    const ctx = await mountedStore()
    await expect(ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'missing',
    })).rejects.toThrow()
    expect(ctx.permissionPresets.defaultPreset).toBe('workspace-write')
  })
})

describe('chat session pinning', () => {
  const chatConfig: Config = {
    presets: {
      'read-only': { sandbox: 'read-only', approval: 'ask' },
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    },
    chatPresetIds: ['chat'],
  }

  it('pins the chat preset into a fresh chat session instead of the user default', async () => {
    const ctx = await mounted({ config: chatConfig })
    const chat = ctx.sessions.create(SessionId('chat-fresh'), { meta: { agentPreset: 'chat' } })
    expect(chat.events.map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'read-only' }],
      ['sandbox/mode', { mode: 'read-only' }],
      ['approval/policy', { policy: 'ask' }],
    ])
  })

  it('keeps the user default for non-chat sessions while chat ids are configured', async () => {
    const ctx = await mounted({ config: chatConfig })
    const workspace = ctx.sessions.create(SessionId('workspace-fresh'), { meta: { agentPreset: 'standard' } })
    expect(workspace.events.map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'workspace-write' }],
      ['sandbox/mode', { mode: 'workspace-write' }],
      ['approval/policy', { policy: 'ask' }],
    ])
  })

  it('honors a configured chat preset name other than read-only', async () => {
    const ctx = await mounted({ config: { ...chatConfig, chatPreset: 'workspace-write' } })
    const chat = ctx.sessions.create(SessionId('chat-named'), { meta: { agentPreset: 'chat' } })
    expect(chat.events[0]).toMatchObject({ type: 'permission/preset', data: { preset: 'workspace-write' } })
  })

  it('fails loud at load when the chat preset is missing from the table', async () => {
    await expect(mounted({ config: { ...chatConfig, presets: chatConfig.presets!, chatPreset: 'missing' } }))
      .rejects.toThrow(/unknown preset "missing"/)
  })

  it('pins a chat session created before the service remounts', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('permission tests do not execute bash') },
      run() { throw new Error('permission tests do not execute bash') },
      start() { throw new Error('permission tests do not execute bash') },
    })
    ctx.provide('approval', { config: { policy: 'ask' } })
    const existing = ctx.sessions.create(SessionId('existing-chat'), { meta: { agentPreset: 'chat' } })
    expect(existing.events).toEqual([])

    await ctx.plugin(PermissionPresetService, chatConfig)
    expect(existing.events.map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'read-only' }],
      ['sandbox/mode', { mode: 'read-only' }],
      ['approval/policy', { policy: 'ask' }],
    ])
  })
})

describe('chat /permission switch', () => {
  const chatConfig: Config = {
    presets: {
      'read-only': { sandbox: 'read-only', approval: 'ask' },
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    },
    chatPresetIds: ['chat'],
  }

  /** Store-created session plus an idle stub agent the command executor accepts. */
  async function harness(agentPreset?: string): Promise<{ ctx: Context; agent: Agent }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('permission tests do not execute bash') },
      run() { throw new Error('permission tests do not execute bash') },
      start() { throw new Error('permission tests do not execute bash') },
    })
    // The command path writes approval through the live setter; the stand-in
    // records the same durable event the service would.
    ctx.provide('approval', {
      config: { policy: 'ask' },
      setPolicy(agent: Agent, policy: ApprovalPolicy) { setApprovalPolicy(agent.session, policy) },
    })
    await ctx.plugin(PermissionPresetService, chatConfig)
    const session = ctx.sessions.create(SessionId(`switch-${Math.random()}`), {
      ...agentPreset === undefined ? {} : { meta: { agentPreset } },
    })
    const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
    let status: AgentStatus = 'idle'
    const agent: Agent = {
      id: session.id,
      options: {},
      session,
      inbox,
      ctx: new Context(),
      get status() { return status },
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject(input) { inbox.append('next-step', input) },
      cancel() { status = 'idle' },
      runMaintenance: task => task(new AbortController().signal),
      whenIdle() { return Promise.resolve() },
    }
    ctx.agents.register(agent)
    return { ctx, agent }
  }

  it('refuses the switch while a session runs a chat preset', async () => {
    const { ctx, agent } = await harness('chat')
    const execution = await ctx.commands.execute(agent, '/permission workspace-write', new AbortController().signal)
    expect(execution).not.toBeUndefined()
    expect(execution!.result.kind).toBe('error')
    expect(execution!.result.text).toBe('Chat sessions run read-only and cannot switch permission presets.')
    // No knob moved: the session still folds to the pinned read-only preset.
    expect(ctx.permissionPresets.current(agent.session.events)).toBe('read-only')
  })

  it('still switches a non-chat session while chat ids are configured', async () => {
    const { ctx, agent } = await harness('standard')
    const execution = await ctx.commands.execute(agent, '/permission danger-full-access', new AbortController().signal)
    expect(execution).not.toBeUndefined()
    expect(execution!.result.kind).toBe('success')
    expect(ctx.permissionPresets.current(agent.session.events)).toBe('danger-full-access')
  })

  it('unlocks the switch after a blank session leaves the chat preset', async () => {
    const { ctx, agent } = await harness('chat')
    agent.session.append('agent-preset/selected', { agentPreset: 'standard' })
    const execution = await ctx.commands.execute(agent, '/permission workspace-write', new AbortController().signal)
    expect(execution).not.toBeUndefined()
    expect(execution!.result.kind).toBe('success')
    expect(ctx.permissionPresets.current(agent.session.events)).toBe('workspace-write')
  })
})
