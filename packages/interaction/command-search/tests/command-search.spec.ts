import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime, { CommandId } from '@deepseek-ai/dsh-commands'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import {
  SubprocessRuntime,
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessOutputReader,
  type SubprocessSpawnSpec,
  type SubprocessTerminalHandle,
  type SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import * as commandSearch from '@deepseek-ai/dsh-command-search'
import type {} from '@deepseek-ai/dsh-workspace-references'

const CWD = '/tmp/dsh-search-cwd'
const REFERENCE = '/tmp/dsh-search-reference'

/** One queued spawn behavior of the fake subprocess. */
interface Behavior {
  /** Synchronous spawn() failure. */
  spawnError?: unknown
  /** `handle.done` rejection. */
  doneError?: Error
  /** Exit facts when the process closes normally. */
  outcome?: SubprocessOutcome
  /** Retained stdout text; omitting it removes the stdout reader entirely. */
  stdout?: string
  /** Report the retained stdout as lossy. */
  stdoutLossy?: boolean
  /** Retained stderr text. */
  stderr?: string
  /** Wait for the fused signal to abort, then settle with `outcome`. */
  killOnSignal?: boolean
  /** Hook run when the process is about to settle. */
  beforeDone?: (spec: SubprocessSpawnSpec) => void
}

function reader(text: string, lossy: boolean): SubprocessOutputReader {
  return {
    readFrom: (fromByte: number) => fromByte === 0
      ? { text, nextOffset: Buffer.byteLength(text, 'utf8'), lossy }
      : { text: '', nextOffset: fromByte, lossy },
  }
}

/** A controllable `ctx.subprocess` stand-in recording every spawn spec. */
class FakeSubprocess extends SubprocessRuntime {
  readonly specs: SubprocessSpawnSpec[] = []
  private queue: Behavior[] = []

  enqueue(behavior: Behavior): void {
    this.queue.push(behavior)
  }

  resolveExecutable(): Promise<string> {
    return Promise.reject(new Error('fake subprocess: resolveExecutable is unused'))
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('fake subprocess: spawnTerminal is unused'))
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const behavior = this.queue.shift()
    if (behavior === undefined) throw new Error('fake subprocess: no behavior queued')
    if (behavior.spawnError !== undefined) throw behavior.spawnError
    this.specs.push(spec)
    const { outcome = { exitCode: 0, signal: null } } = behavior
    const done: Promise<SubprocessOutcome> = behavior.killOnSignal === true
      ? new Promise((resolve) => {
        const onAbort = (): void => { resolve(outcome) }
        if (spec.signal?.aborted === true) onAbort()
        else spec.signal?.addEventListener('abort', onAbort, { once: true })
      })
      : new Promise((resolve, reject) => {
        queueMicrotask(() => {
          behavior.beforeDone?.(spec)
          if (behavior.doneError !== undefined) reject(behavior.doneError)
          else resolve(outcome)
        })
      })
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        ...(behavior.stdout === undefined ? {} : { stdout: reader(behavior.stdout, behavior.stdoutLossy === true) }),
        ...(behavior.stderr === undefined ? {} : { stderr: reader(behavior.stderr, false) }),
      },
      done,
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }
}

interface Harness {
  readonly ctx: Context
  readonly subprocess: FakeSubprocess
  readonly session: Session
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

async function harness(opts: { cwd?: string; references?: readonly string[] } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  const subprocess = new FakeSubprocess(ctx)
  const plugin = await ctx.plugin(commandSearch)
  const id = SessionId('command-search')
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    ...opts.cwd === undefined ? {} : { cwd: opts.cwd },
  }
  const session = Session.create(id, [], header)
  for (const reference of opts.references ?? []) {
    session.append('workspace/references', { references: [{ path: reference }] })
  }
  const agent = {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { ctx, subprocess, session, agent, plugin }
}

async function run(
  test: Harness,
  line: string,
  controller = new AbortController(),
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>> {
  const execution = await test.ctx.commands.execute(test.agent, line, controller.signal)
  if (execution === undefined) throw new Error('search command was not registered')
  return execution
}

/** Assert the executor-owned lifecycle pair and absence from model history. */
function expectLastLifecycle(
  test: Harness,
  args: string,
  outcome: { kind: string; text?: string },
): string {
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
      data: { commandId: runEvent.data.commandId, name: 'search', args, source: { kind: 'user' } },
    },
    {
      type: 'command/done',
      data: { commandId: doneEvent.data.commandId, kind: outcome.kind, ...(outcome.text === undefined ? {} : { text: outcome.text }) },
    },
  ])
  expect(test.session.surface.nodes).toEqual([])
  expect(test.session.deriveMessages()).toEqual([])
  return runEvent.data.commandId
}

afterEach(async () => {
  vi.useRealTimers()
})

describe('@deepseek-ai/dsh-command-search registration', () => {
  it('registers the command with an input hint and disposes it', async () => {
    const test = await harness({ cwd: CWD })
    expect(commandSearch.name).toBe('command-search')
    expect(commandSearch.inject).toEqual(['commands', 'subprocess'])
    expect('default' in commandSearch).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandSearch)).toBe(commandSearch)
    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'search',
      description: 'Search this session workspace and its reference projects (literal text)',
      input: { hint: '<literal text>' },
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'search')).toBeUndefined()
  })
})

describe('/search roots', () => {
  it('refuses a bare invocation with usage', async () => {
    const test = await harness({ cwd: CWD })
    const execution = await run(test, '/search   ')
    expect(execution.result).toEqual({
      kind: 'error',
      text: 'Usage: /search <literal text> — searches this session workspace and its reference projects',
    })
    expect(execution.commandId).toBe(expectLastLifecycle(test, '   ', execution.result as { kind: string; text: string }))
    expect(test.subprocess.specs).toEqual([])
  })

  it('refuses a session without a project directory or references', async () => {
    const test = await harness()
    const execution = await run(test, '/search needle')
    expect(execution.result).toEqual({
      kind: 'error',
      text: 'This session has no project directory and no reference projects to search.',
    })
    expect(test.subprocess.specs).toEqual([])
  })

  it('spawns ripgrep over the session cwd with a fixed literal argv', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ stdout: `${CWD}/src/a.ts:3:needle here` })
    await run(test, '/search needle')
    expect(test.subprocess.specs).toHaveLength(1)
    const spec = test.subprocess.specs[0]
    if (spec === undefined) throw new Error('expected one spawn')
    expect(spec.cwd).toBe(CWD)
    expect(spec.argv).toEqual([
      expect.stringContaining('rg'),
      '--no-config',
      '--fixed-strings',
      '-H',
      '--line-number',
      '--max-count',
      '200',
      '--',
      'needle',
      CWD,
    ])
    expect(spec.stdio.stdin).toBe('ignore')
    expect(spec.graceMs).toBe(3_000)
    expect(spec.signal?.aborted).toBe(false)
  })

  it('searches the cwd first and every attached reference after it', async () => {
    const test = await harness({ cwd: CWD, references: [REFERENCE] })
    test.subprocess.enqueue({ stdout: `${CWD}/a.ts:1:x` })
    await run(test, '/search x')
    const spec = test.subprocess.specs[0]
    if (spec === undefined) throw new Error('expected one spawn')
    expect(spec.argv.slice(-3)).toEqual(['x', CWD, REFERENCE])
    expect(spec.cwd).toBe(CWD)
  })

  it('falls back to the first reference as the spawn directory when the session has no cwd', async () => {
    const test = await harness({ references: [REFERENCE] })
    test.subprocess.enqueue({ outcome: { exitCode: 1, signal: null } })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({ kind: 'success', text: 'No matches for "x".' })
    const spec = test.subprocess.specs[0]
    if (spec === undefined) throw new Error('expected one spawn')
    expect(spec.cwd).toBe(REFERENCE)
    expect(spec.argv).toContain(REFERENCE)
  })
})

describe('/search results', () => {
  it('reports a zero-match run as a success with no match lines', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ outcome: { exitCode: 1, signal: null } })
    const execution = await run(test, '/search needle')
    expect(execution.result).toEqual({ kind: 'success', text: 'No matches for "needle".' })
    expect(execution.commandId).toBe(expectLastLifecycle(test, ' needle', execution.result as { kind: string; text: string }))
  })

  it('reports an exit-zero run with no parseable matches as a success with no match lines', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ stdout: 'binary file matches' })
    const execution = await run(test, '/search needle')
    expect(execution.result).toEqual({ kind: 'success', text: 'No matches for "needle".' })
  })

  it('folds match lines as path:line: text with cwd-relative display paths', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({
      stdout: [
        `${CWD}/src/a.ts:3:first hit`,
        `${CWD}/src/b.ts:10:second hit`,
      ].join('\n'),
    })
    const execution = await run(test, '/search hit')
    expect(execution.result).toEqual({
      kind: 'success',
      text: 'src/a.ts:3: first hit\nsrc/b.ts:10: second hit',
    })
  })

  it('keeps absolute display paths for matches outside every search root', async () => {
    const test = await harness({ cwd: CWD, references: [REFERENCE] })
    test.subprocess.enqueue({ stdout: `${REFERENCE}/lib/a.ts:7:ref hit` })
    const execution = await run(test, '/search ref hit')
    expect(execution.result).toEqual({ kind: 'success', text: `${REFERENCE}/lib/a.ts:7: ref hit` })
  })

  it('passes relative and ancestor display paths through unchanged', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({
      stdout: [
        'relative/a.ts:1:relative output',
        `${CWD}:2:root itself`,
        '/tmp:3:parent dir',
        '/other/a.ts:4:outside',
      ].join('\n'),
    })
    const execution = await run(test, '/search output')
    expect(execution.result).toEqual({
      kind: 'success',
      text: 'relative/a.ts:1: relative output\n.:2: root itself\n/tmp:3: parent dir\n/other/a.ts:4: outside',
    })
  })

  it('skips binary notes and malformed lines', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({
      stdout: [
        'binary file matches',
        '',
        `${CWD}/a.ts:1:keep one`,
        `${CWD}/a.ts:0:zero line`,
        `${CWD}/a.ts:abc:nan line`,
        `${CWD}/a.ts:2:keep two`,
      ].join('\n'),
    })
    const execution = await run(test, '/search keep')
    expect(execution.result).toEqual({ kind: 'success', text: 'a.ts:1: keep one\na.ts:2: keep two' })
  })

  it('caps the folded match count at 200', async () => {
    const test = await harness({ cwd: CWD })
    const lines = Array.from({ length: 250 }, (_, index) => `${CWD}/f.ts:${index + 1}:m${index}`)
    test.subprocess.enqueue({ stdout: lines.join('\n') })
    const execution = await run(test, '/search m')
    const result = execution.result
    if (result.kind !== 'success' || result.text === undefined) throw new Error(`expected success text, got ${result.kind}`)
    const folded = result.text.split('\n')
    expect(folded).toHaveLength(200)
    expect(folded[0]).toBe('f.ts:1: m0')
    expect(folded[199]).toBe('f.ts:200: m199')
  })

  it('re-folds until the result byte budget holds and notes the fold', async () => {
    const test = await harness({ cwd: CWD })
    const long = 'x'.repeat(9_000)
    test.subprocess.enqueue({
      stdout: Array.from({ length: 4 }, (_, index) => `${CWD}/a.ts:${index + 1}:${long}`).join('\n'),
    })
    const execution = await run(test, '/search x')
    const result = execution.result
    if (result.kind !== 'success') throw new Error(`expected success, got ${result.kind}`)
    expect(result.text).toContain(`a.ts:1: ${long}`)
    expect(result.text).toContain('… truncated to fit the result budget (showing 1 of 4 matches)')
    expect(result.text).not.toContain('a.ts:2:')
  })

  it('bounds a single oversized line to the result byte budget with a marker', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ stdout: `${CWD}/a.ts:1:${'x'.repeat(20_000)}` })
    const execution = await run(test, '/search x')
    const result = execution.result
    if (result.kind !== 'success') throw new Error(`expected success, got ${result.kind}`)
    const text = result.text
    if (text === undefined) throw new Error('expected result text')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
    expect(text.startsWith('a.ts:1: ')).toBe(true)
    expect(text.endsWith('… (line truncated)')).toBe(true)
    expect(text).not.toContain('truncated to fit')
  })

  it('fails a run whose raw stdout overflowed the retained cap', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ stdout: 'a.ts:1:tail', stdoutLossy: true })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({
      kind: 'error',
      text: 'Search produced more raw output than the 262144-byte cap retained; narrow the pattern or the roots.',
    })
  })

  it('reports a spawn that produced no stdout stream', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({})
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({ kind: 'error', text: 'Search produced no output stream.' })
  })

  it('classifies a ripgrep failure with its stderr excerpt', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ outcome: { exitCode: 2, signal: null }, stderr: 'ripgrep: error: missing root' })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({
      kind: 'error',
      text: 'Search failed (ripgrep exit 2): ripgrep: error: missing root',
    })
  })

  it('classifies a ripgrep failure without stderr', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ outcome: { exitCode: 3, signal: null } })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({ kind: 'error', text: 'Search failed (ripgrep exit 3)' })
  })

  it('reports a signal-killed run as killed', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ outcome: { exitCode: null, signal: 'SIGKILL' }, killOnSignal: false })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({ kind: 'error', text: 'Search was killed by signal SIGKILL.' })
  })

  it('reports an unnamed killed outcome with an unknown signal placeholder', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ outcome: { exitCode: null, signal: null }, killOnSignal: false })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({ kind: 'error', text: 'Search was killed by signal (unknown).' })
  })

  it('reports a spawn creation failure', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ spawnError: new Error('boom') })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({
      kind: 'error',
      text: 'Search could not start (ripgrep launch failed): Error: boom',
    })
  })

  it('reports a spawn-level rejection of handle.done', async () => {
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ doneError: new Error('infra down') })
    const execution = await run(test, '/search x')
    expect(execution.result).toEqual({
      kind: 'error',
      text: 'Search could not start (ripgrep launch failed): Error: infra down',
    })
  })

  it('classifies a launch failure that races an abort as cancelled', async () => {
    const test = await harness({ cwd: CWD })
    const controller = new AbortController()
    test.subprocess.enqueue({ doneError: new Error('infra down') })
    const definition = test.ctx.commands.find(test.agent, 'search')
    if (definition === undefined) throw new Error('search command was not registered')
    controller.abort(new Error('user cancelled'))
    const result = await definition.handler({
      commandId: CommandId('command-search-test'),
      agent: test.agent,
      rawInput: ' x',
      signal: controller.signal,
    })
    expect(result).toEqual({ kind: 'error', text: 'Search cancelled.' })
  })

  it('rejects without a lifecycle record when the UI aborts before the run', async () => {
    const test = await harness({ cwd: CWD })
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    await expect(test.ctx.commands.execute(test.agent, '/search x', controller.signal))
      .rejects.toThrow('user cancelled')
    expect(test.session.events.filter(event => event.type === 'command/run' || event.type === 'command/done'))
      .toEqual([])
    expect(test.subprocess.specs).toEqual([])
  })

  it('settles an in-flight search as the abort on the recorded lifecycle', async () => {
    const test = await harness({ cwd: CWD })
    const controller = new AbortController()
    test.subprocess.enqueue({
      outcome: { exitCode: 0, signal: null },
      stdout: `${CWD}/a.ts:1:hit`,
      beforeDone: () => { controller.abort(new Error('user cancelled')) },
    })
    const pending = test.ctx.commands.execute(test.agent, '/search x', controller.signal)
    await expect(pending).rejects.toThrow('user cancelled')
    const done = test.session.events
      .filter(event => event.type === 'command/done')
      .map(event => event.data)
      .pop()
    expect(done).toMatchObject({ kind: 'error', text: 'user cancelled' })
  })

  it('settles a killed search as the abort when the UI cancels a long-running run', async () => {
    const test = await harness({ cwd: CWD })
    const controller = new AbortController()
    test.subprocess.enqueue({ outcome: { exitCode: null, signal: 'SIGTERM' }, killOnSignal: true })
    const pending = test.ctx.commands.execute(test.agent, '/search x', controller.signal)
    await Promise.resolve()
    controller.abort(new Error('user cancelled'))
    await expect(pending).rejects.toThrow('user cancelled')
    const done = test.session.events
      .filter(event => event.type === 'command/done')
      .map(event => event.data)
      .pop()
    expect(done).toMatchObject({ kind: 'error', text: 'user cancelled' })
  })

  it('reports a deadline kill as a timeout', async () => {
    vi.useFakeTimers()
    const test = await harness({ cwd: CWD })
    test.subprocess.enqueue({ outcome: { exitCode: null, signal: 'SIGTERM' }, killOnSignal: true })
    const pending = run(test, '/search x')
    await vi.advanceTimersByTimeAsync(30_000)
    const execution = await pending
    expect(execution.result).toEqual({ kind: 'error', text: 'Search timed out after 30s.' })
  })
})
