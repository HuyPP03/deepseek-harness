import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import * as commandAgentActions from '@deepseek-ai/dsh-command-agent-actions'
import { ScriptedReviewer } from './scripted-reviewer'

const SIMPLIFY_TEXT = 'Simplification queued for this session.'
const REVIEW_EMPTY_TEXT = 'No code changes were found in this session to review.'


interface Harness {
  readonly ctx: Context
  readonly subagents: SubagentRuntime
  readonly reviewer: ScriptedReviewer | undefined
  readonly session: Session
  readonly agent: Agent
  readonly steer: ReturnType<typeof vi.fn>
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

async function harness(opts: { changedFiles?: string[]; provider?: string; config?: Record<string, unknown> } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  const subagents = new SubagentRuntime(ctx)
  let reviewer: ScriptedReviewer | undefined
  if (opts.provider !== undefined) {
    reviewer = new ScriptedReviewer(opts.provider, [
      { reply: 'correctness finding', settleMs: 1 },
      { reply: 'security finding', settleMs: 1 },
      { reply: 'performance finding', settleMs: 1 },
      { reply: 'maintainability finding', settleMs: 1 },
    ])
    subagents.registerProvider(reviewer)
  }
  const plugin = await ctx.plugin(commandAgentActions, opts.config ?? {})
  const id = SessionId('command-agent-actions')
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 0 }
  const session = Session.create(id, [], header)
  let step = 0
  for (const filePath of opts.changedFiles ?? []) {
    session.append('tool/call', {
      turn: 1,
      step: step++,
      callId: CallId(`call-${step}`),
      name: 'write',
      arguments: JSON.stringify({ file_path: filePath }),
    })
  }
  const steer = vi.fn()
  const agent = {
    session,
    status: 'idle',
    steer,
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { ctx, subagents, reviewer, session, agent, steer, plugin }
}

async function run(
  test: Harness,
  line: string,
  controller = new AbortController(),
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>> {
  const execution = await test.ctx.commands.execute(test.agent, line, controller.signal)
  if (execution === undefined) throw new Error('command was not registered')
  return execution
}

/** Assert the executor-owned lifecycle pair and absence from model history. */
function expectLastLifecycle(
  test: Harness,
  name: 'simplify' | 'code-review',
  args: string,
  outcome: { kind: string; text?: string },
): void {
  const lifecycle = test.session.events
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .slice(-2)
  const runEvent = lifecycle[0]
  const doneEvent = lifecycle[1]
  if (runEvent?.type !== 'command/run' || doneEvent?.type !== 'command/done') {
    throw new Error(`expected command lifecycle pair, got ${lifecycle.map(event => event.type).join(',')}`)
  }
  expect(lifecycle.map(event => ({ type: event.type, data: event.data }))).toEqual([
    {
      type: 'command/run',
      data: { commandId: runEvent.data.commandId, name, args, source: { kind: 'user' } },
    },
    {
      type: 'command/done',
      data: { commandId: doneEvent.data.commandId, kind: outcome.kind, ...(outcome.text === undefined ? {} : { text: outcome.text }) },
    },
  ])
  expect(test.session.surface.nodes).toEqual([])
  expect(test.session.deriveMessages()).toEqual([])
}

afterEach(async () => {
  vi.useRealTimers()
})

describe('@deepseek-ai/dsh-command-agent-actions registration', () => {
  it('registers both commands and disposes them', async () => {
    const test = await harness()
    expect(commandAgentActions.name).toBe('command-agent-actions')
    expect(commandAgentActions.inject).toEqual(['commands', 'subagents'])
    expect('default' in commandAgentActions).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandAgentActions)).toBe(commandAgentActions)
    const listed = test.ctx.commands.list(test.agent)
    expect(listed).toContainEqual({
      name: 'simplify',
      description: 'Ask the agent to simplify the code touched in this session',
    })
    expect(listed).toContainEqual({
      name: 'code-review',
      description: 'Review the code changed in this session with four parallel reviewers (report only)',
    })
    expect(listed).toHaveLength(2)

    await test.plugin.dispose()
    expect(test.ctx.commands.list(test.agent)).toEqual([])
  })
})

describe('/simplify', () => {
  it('steers the agent with the simplification directive and settles log-only', async () => {
    const test = await harness()
    const execution = await run(test, '/simplify')
    expect(execution.result).toEqual({ kind: 'success', text: SIMPLIFY_TEXT })
    expect(test.steer).toHaveBeenCalledTimes(1)
    const call = test.steer.mock.calls[0]
    if (call === undefined) throw new Error('expected one steer call')
    const message = call[0] as {
      content: readonly { type: string; text: string }[]
      source: { kind: string; plugin?: string }
    }
    const firstText = message.content.find(block => block.type === 'text')?.text
    expect(firstText).toBeDefined()
    expect(firstText).toContain('Simplify the code touched in this session')
    expect(message.source).toEqual({ kind: 'plugin', plugin: 'command-agent-actions' })
    expectLastLifecycle(test, 'simplify', '', { kind: 'success', text: SIMPLIFY_TEXT })
  })

  it('refuses arguments with usage and steers nothing', async () => {
    const test = await harness()
    const execution = await run(test, '/simplify now')
    expect(execution.result).toEqual({ kind: 'error', text: 'Usage: /simplify (no arguments)' })
    expect(test.steer).not.toHaveBeenCalled()
    expectLastLifecycle(test, 'simplify', ' now', { kind: 'error', text: 'Usage: /simplify (no arguments)' })
  })

  it('settles while the agent is running: the steer is consumed at the next step boundary', async () => {
    const test = await harness()
    ;(test.agent as unknown as { status: string }).status = 'running'
    const execution = await run(test, '/simplify')
    expect(execution.result).toEqual({ kind: 'success', text: SIMPLIFY_TEXT })
    expect(test.steer).toHaveBeenCalledTimes(1)
  })
})

describe('/code-review scope derivation', () => {
  it('reports a session without recorded edits and starts nothing', async () => {
    const test = await harness({ provider: 'spawn' })
    const execution = await run(test, '/code-review')
    expect(execution.result).toEqual({ kind: 'success', text: REVIEW_EMPTY_TEXT })
    expect(test.reviewer?.requests).toEqual([])
    expect(test.steer).not.toHaveBeenCalled()
  })

  it('counts only edit and write call sites, deduplicated in first-touched order', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    const session = test.session
    session.append('tool/call', { turn: 1, step: 9, callId: CallId('read-1'), name: 'read', arguments: JSON.stringify({ file_path: 'src/skip.ts' }) })
    session.append('tool/call', { turn: 1, step: 10, callId: CallId('bash-1'), name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) })
    session.append('tool/call', { turn: 1, step: 11, callId: CallId('edit-1'), name: 'edit', arguments: JSON.stringify({ file_path: 'src/b.ts', old_string: 'x', new_string: 'y' }) })
    session.append('tool/call', { turn: 1, step: 12, callId: CallId('edit-2'), name: 'edit', arguments: JSON.stringify({ file_path: 'src/a.ts', old_string: 'x', new_string: 'y' }) })
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 13, callId: CallId('bad-1'), name: 'write', arguments: '{not json' })
    session.append('tool/call', { turn: 1, step: 14, callId: CallId('scalar-1'), name: 'write', arguments: '42' })
    session.append('tool/call', { turn: 1, step: 15, callId: CallId('empty-1'), name: 'write', arguments: JSON.stringify({ file_path: '' }) })
    session.append('tool/call', { turn: 1, step: 16, callId: CallId('nopath-1'), name: 'write', arguments: JSON.stringify({ tool: 'write' }) })
    const execution = await run(test, '/code-review')
    expect(execution.result.kind).toBe('success')
    const text = (execution.result as { text: string }).text
    expect(text).toContain('Code review of 2 changed files (report-only):')
    const prompt = test.reviewer?.requests[0]!.prompt[0] as { type: string; text: string }
    expect(prompt.text).toContain('- src/a.ts')
    expect(prompt.text).toContain('- src/b.ts')
    expect(prompt.text).not.toContain('src/skip.ts')
  })

  it('caps the quoted file list at 100 paths', async () => {
    const files = Array.from({ length: 101 }, (_, index) => `src/file-${index}.ts`)
    const test = await harness({ changedFiles: files, provider: 'spawn' })
    const execution = await run(test, '/code-review')
    expect(execution.result.kind).toBe('success')
    const prompt = test.reviewer?.requests[0]!.prompt[0] as { type: string; text: string }
    expect(prompt.text).toContain('- src/file-99.ts')
    expect(prompt.text).toContain('(and 1 more changed files)')
    expect(prompt.text).not.toContain('src/file-100.ts')
  })
})

describe('/code-review provider fallback', () => {
  it('steers the agent when the configured provider is absent', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], config: { provider: 'acp' } })
    const execution = await run(test, '/code-review')
    expect(execution.result).toEqual({
      kind: 'success',
      text: 'Subagent provider "acp" is not available in this deployment; the review was queued on this agent instead.',
    })
    expect(test.steer).toHaveBeenCalledTimes(1)
    const call = test.steer.mock.calls[0]
    if (call === undefined) throw new Error('expected one steer call')
    const message = call[0] as {
      content: readonly { type: string; text: string }[]
    }
    const firstText = message.content.find(block => block.type === 'text')?.text
    expect(firstText).toBeDefined()
    expect(firstText).toContain('Review the code changed in this session')
  })

  it('refuses arguments with usage', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'] })
    const execution = await run(test, '/code-review please')
    expect(execution.result).toEqual({ kind: 'error', text: 'Usage: /code-review (no arguments)' })
  })
})

describe('/code-review four-facet report', () => {
  it('starts four parallel reviewers and folds one report-only result', async () => {
    const test = await harness({ changedFiles: ['src/a.ts', 'src/b.ts'], provider: 'spawn' })
    const execution = await run(test, '/code-review')
    expect(execution.result.kind).toBe('success')
    const text = (execution.result as { text: string }).text
    expect(text).toContain('Code review of 2 changed files (report-only):')
    const sections = ['## correctness', '## security', '## performance', '## maintainability']
    const positions = sections.map(section => text.indexOf(section))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(text).toContain('correctness finding')
    expect(text).toContain('security finding')
    expect(text).toContain('performance finding')
    expect(text).toContain('maintainability finding')

    const reviewer = test.reviewer
    expect(reviewer?.requests).toHaveLength(4)
    expect(reviewer?.requests.map(request => request.label)).toEqual([
      'code-review correctness',
      'code-review security',
      'code-review performance',
      'code-review maintainability',
    ])
    expect(reviewer?.requests.map(request => request.parent.session.id)).toEqual([
      test.agent.session.id,
      test.agent.session.id,
      test.agent.session.id,
      test.agent.session.id,
    ])
    const focus = reviewer?.requests.map(request => (request.prompt[0] as { text: string }).text)
    expect(focus?.[0]).toContain('logic errors')
    expect(focus?.[1]).toContain('trust-boundary mistakes')
    expect(focus?.[2]).toContain('repeated scans')
    expect(focus?.[3]).toContain('duplication')
    expect(reviewer?.runs).toHaveLength(4)
    for (const spy of reviewer?.disposeSpies ?? []) expect(spy).toHaveBeenCalled()
  })

  it('reports a facet whose start failed and keeps the others', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    test.reviewer!.queue.splice(1, 1, { startError: new Error('provider exploded') })
    const execution = await run(test, '/code-review')
    expect(execution.result.kind).toBe('success')
    const text = (execution.result as { text: string }).text
    expect(text).toContain('## correctness')
    expect(text).toContain('## performance')
    expect(text).toContain('## failed facets')
    expect(text).toContain('security: Error: provider exploded')
  })

  it('errors when every facet start fails', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    for (let i = 0; i < 4; i += 1) {
      test.reviewer!.queue.splice(i, 1, { startError: new Error(`down ${i}`) })
    }
    await expect(run(test, '/code-review')).rejects.toThrow('maintainability: Error: down 3')
    const done = test.session.events
      .filter(event => event.type === 'command/done')
      .at(-1)
    expect(done?.type).toBe('command/done')
    if (done?.type !== 'command/done') throw new Error('missing command/done')
    expect(done.data.kind).toBe('error')
    expect(done.data.text).toContain('correctness: Error: down 0')
  })

  it('settles as an aborted error when the signal aborts mid-flight', async () => {
    vi.useFakeTimers()
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    for (let i = 0; i < 4; i += 1) {
      test.reviewer!.queue.splice(i, 1, { reply: `late ${i}`, settleMs: 1000 })
    }
    const controller = new AbortController()
    const pending = run(test, '/code-review', controller)
    // Observe the rejection immediately: the executor settles the abort as a
    // rejection, and the assertion below settles the observation.
    void pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await vi.advanceTimersByTimeAsync(1100)
    await expect(pending).rejects.toThrow(/aborted/i)
    const done = test.session.events
      .filter(event => event.type === 'command/done')
      .at(-1)
    if (done?.type !== 'command/done') throw new Error('missing command/done')
    expect(done.data.kind).toBe('error')
    for (const spy of test.reviewer!.disposeSpies) expect(spy).toHaveBeenCalled()
  })

  it('notes a facet that did not complete and one that produced no text', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    const reviewer = test.reviewer!
    reviewer.queue.splice(0, 1, { reply: 'done', stopReason: 'completed' })
    reviewer.queue.splice(1, 1, { reply: 'cut off', stopReason: 'max-tokens' })
    reviewer.queue.splice(2, 1, { reply: '', stopReason: 'completed' })
    reviewer.queue.splice(3, 1, { reply: 'clean', stopReason: 'completed' })
    const execution = await run(test, '/code-review')
    const text = (execution.result as { text: string }).text
    expect(text).toContain('## security\n(reviewer did not finish: max-tokens)')
    expect(text).toContain('## performance\n(the reviewer produced no findings text)')
  })

  it('disposes every published review run after the report settles', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    const execution = await run(test, '/code-review')
    expect(execution.result.kind).toBe('success')
    expect(test.reviewer?.disposeSpies).toHaveLength(4)
    for (const spy of test.reviewer?.disposeSpies ?? []) expect(spy).toHaveBeenCalled()
  })

  it('truncates an oversized report to the byte budget with a marker', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    const big = 'x'.repeat(12_000)
    for (let i = 0; i < 4; i += 1) {
      test.reviewer!.queue.splice(i, 1, { reply: big })
    }
    const execution = await run(test, '/code-review')
    const text = (execution.result as { text: string }).text
    expect(text).toContain('… review report truncated to fit the result budget')
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(32 * 1024)
  })
})

describe('command-agent-actions lifecycle', () => {
  it('drains an in-flight review before the plugin fiber settles', async () => {
    const test = await harness({ changedFiles: ['src/a.ts'], provider: 'spawn' })
    for (let i = 0; i < 4; i += 1) {
      test.reviewer!.queue.splice(i, 1, { reply: `late ${i}`, settleMs: 50 })
    }
    const pending = run(test, '/code-review')
    await vi.waitFor(() => { expect(test.reviewer?.runs).toHaveLength(4) })
    await expect(test.plugin.dispose()).resolves.toBeUndefined()
    const execution = await pending
    expect(execution.result.kind).toBe('success')
  })
})
