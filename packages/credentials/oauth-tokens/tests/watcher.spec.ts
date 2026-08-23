import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OAuthTokenStore } from '../src/index.ts'
import type { OAuthTokenBundle } from '../src/types.ts'

const fsHarness = vi.hoisted(() => ({
  nextReadError: undefined as NodeJS.ErrnoException | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: unknown, ...rest: never[]) => {
      const error = fsHarness.nextReadError
      if (error !== undefined) {
        fsHarness.nextReadError = undefined
        throw error
      }
      return (actual.readFile as (path: unknown, ...args: never[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.readFile,
  }
})

/** Token documents are seeded owner-only, exactly as the store creates them. */
function writeTokens(file: string, owners: Record<string, unknown>): Promise<void> {
  return writeFile(file, JSON.stringify(owners, null, 2) + '\n', { mode: 0o600 })
}

// chokidar is the nondeterministic OS boundary: faking it lets these tests
// drive the event pipeline (error events, ready races, dispose races)
// deterministically. Real end-to-end watching stays covered by CI lanes.
vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWatcher extends EventEmitter {
    close = vi.fn(() => Promise.resolve())
  }
  const instances: Array<{ path: string; options: unknown; watcher: InstanceType<typeof FakeWatcher> }> = []
  return {
    watch: vi.fn((path: string, options: unknown) => {
      const watcher = new FakeWatcher()
      instances.push({ path, options, watcher })
      return watcher
    }),
    __instances: instances,
  }
})

interface FakeChokidar {
  __instances: Array<{
    path: string
    options: { awaitWriteFinish: { stabilityThreshold: number; pollInterval: number } }
    watcher: import('node:events').EventEmitter
  }>
}

async function fakeInstances(): Promise<FakeChokidar['__instances']> {
  const chokidar = await import('chokidar') as unknown as FakeChokidar
  return chokidar.__instances
}

function bundle(overrides: Record<string, unknown> = {}): OAuthTokenBundle {
  const now = Date.now()
  return {
    accessToken: 'at-1',
    expiresAt: now + 3_600_000,
    tokenEndpoint: 'https://provider.example/token',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  fsHarness.nextReadError = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
  ;(await fakeInstances()).length = 0
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-tokens-watch-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(config: ConstructorParameters<typeof OAuthTokenStore>[1]): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(OAuthTokenStore, config)
  cleanups.push(async () => {
    await fiber.dispose()
  })
  await fiber
  return ctx
}

describe('watcher pipeline', () => {
  it('clamps the write-settle poll interval for a zero debounce', async () => {
    const dir = await tempDir()
    await boot({ path: join(dir, 'tokens.json'), debounceMs: 0 })
    const [instance] = await fakeInstances()
    expect(instance!.options.awaitWriteFinish).toEqual({ stabilityThreshold: 0, pollInterval: 1 })
  })

  it('clamps the poll interval above the debounce', async () => {
    const dir = await tempDir()
    await boot({ path: join(dir, 'tokens.json'), debounceMs: 500 })
    const [instance] = await fakeInstances()
    expect(instance!.options.awaitWriteFinish).toEqual({ stabilityThreshold: 500, pollInterval: 10 })
  })

  it('survives a watcher error and keeps publishing later edits', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    const ctx = await boot({ path, debounceMs: 5 })
    const [instance] = await fakeInstances()

    instance!.watcher.emit('error', new Error('watch backend failure'))
    expect(ctx.oauthTokens.list()).toEqual([])

    await writeTokens(path, { notion: bundle() })
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-1')
    })
  })

  it('hot-publishes an external edit and reports each changed owner once', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await writeTokens(path, { notion: bundle() })
    const ctx = await boot({ path, debounceMs: 5 })
    const seen: string[] = []
    ctx.on('oauth-tokens/updated', (ownerId) => {
      seen.push(ownerId)
    })

    // An external writer replaces the document: one owner changed, one added,
    // one removed. The snapshot is replaced wholesale.
    await writeTokens(path, { notion: bundle({ accessToken: 'at-2' }), slack: bundle({ accessToken: 'at-s' }) })
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(ctx.oauthTokens.get('slack')?.accessToken).toBe('at-s')
    })
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-2')
    expect(seen).toEqual(['notion', 'slack'])
  })

  it('empties the snapshot when the document is deleted and emits the removals', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await writeTokens(path, { notion: bundle(), slack: bundle() })
    const ctx = await boot({ path, debounceMs: 5 })
    const seen: string[] = []
    ctx.on('oauth-tokens/updated', (ownerId) => {
      seen.push(ownerId)
    })

    await rm(path)
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'unlink', path)
    await vi.waitFor(() => {
      expect(ctx.oauthTokens.list()).toEqual([])
    })
    expect(seen).toEqual(['notion', 'slack'])
  })

  it('treats an event for a still-absent file as a no-op', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    const ctx = await boot({ path, debounceMs: 5 })
    const seen: string[] = []
    ctx.on('oauth-tokens/updated', (ownerId) => {
      seen.push(ownerId)
    })
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'add', path)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ctx.oauthTokens.list()).toEqual([])
    expect(seen).toEqual([])
  })

  it('keeps the last good snapshot when an external edit makes the document invalid', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await writeTokens(path, { notion: bundle() })
    const ctx = await boot({ path, debounceMs: 5 })
    const seen: string[] = []
    ctx.on('oauth-tokens/updated', (ownerId) => {
      seen.push(ownerId)
    })

    await writeFile(path, '{oops', { mode: 0o600 })
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'change', path)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-1')
    expect(seen).toEqual([])

    // Repairing the document resumes publishing.
    await writeTokens(path, { notion: bundle({ accessToken: 'at-2' }) })
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-2')
    })
    expect(seen).toEqual(['notion'])
  })

  it('keeps the last good snapshot when the read fails after its permission check', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await writeTokens(path, { notion: bundle() })
    const ctx = await boot({ path, debounceMs: 5 })
    fsHarness.nextReadError = Object.assign(new Error('EACCES: injected read failure'), { code: 'EACCES' })

    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(fsHarness.nextReadError).toBeUndefined()
    })
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-1')
  })

  it('keeps the reload queue alive after an invariant violation escapes the fan-out', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await writeTokens(path, { notion: bundle() })
    const ctx = await boot({ path, debounceMs: 5 })
    let arm = true
    ctx.on('oauth-tokens/updated', () => {
      if (!arm) return
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    const [instance] = await fakeInstances()

    // The snapshot commits before the fan-out, so the value lands even though
    // the listener threw out of the refresh.
    await writeTokens(path, { notion: bundle({ accessToken: 'at-2' }) })
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-2')
    })

    arm = false
    await writeTokens(path, { notion: bundle({ accessToken: 'at-3' }) })
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-3')
    })
  })

  it('reconciles at watcher ready so a change during setup is not missed', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await writeTokens(path, { notion: bundle() })
    const ctx = await boot({ path, debounceMs: 5 })
    // Written after the initial load but before the watcher became active:
    // no 'all' event will ever fire for it.
    await writeTokens(path, { notion: bundle({ accessToken: 'written-before-ready' }) })
    const [instance] = await fakeInstances()
    instance!.watcher.emit('ready')
    await vi.waitFor(() => {
      expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('written-before-ready')
    })
  })

  it('quiesces the refresh pipeline before dispose completes', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await writeTokens(path, { notion: bundle() })
    const ctx = new Context()
    const fiber = ctx.plugin(OAuthTokenStore, { path, debounceMs: 5 })
    await fiber
    let disposed = false
    let postDisposeCommits = 0
    ctx.on('oauth-tokens/updated', () => {
      if (disposed) postDisposeCommits += 1
    })

    await writeTokens(path, { notion: bundle({ accessToken: 'changed' }) })
    const [instance] = await fakeInstances()
    // Two queued refreshes: dispose interrupts one mid-flight and the other
    // before it starts, so both closed guards must hold.
    instance!.watcher.emit('all', 'change', path)
    instance!.watcher.emit('all', 'change', path)
    await fiber.dispose()
    disposed = true
    instance!.watcher.emit('all', 'change', path)
    instance!.watcher.emit('ready')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(postDisposeCommits).toBe(0)
  })
})

describe('commit fan-out containment', () => {
  async function seeded(ctx: Context): Promise<void> {
    await ctx.oauthTokens.put('notion', bundle())
  }

  it('does not fail a committed put when a listener throws, and later listeners still run', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, 'tokens.json'), watch: false })
    ctx.on('oauth-tokens/updated', () => {
      throw new Error('sync observer boom')
    })
    const second = vi.fn()
    ctx.on('oauth-tokens/updated', second)
    await expect(ctx.oauthTokens.put('notion', bundle())).resolves.toBeUndefined()
    expect(second).toHaveBeenCalledWith('notion')
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-1')
  })

  it('contains an async listener rejection', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, 'tokens.json'), watch: false })
    // An unknown-returning function keeps the typed surface legal while the
    // runtime value is still the rejected promise the containment must handle.
    const boom = (): unknown => Promise.reject(new Error('async observer boom'))
    ctx.on('oauth-tokens/updated', boom)
    await expect(ctx.oauthTokens.put('notion', bundle())).resolves.toBeUndefined()
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-1')
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('rethrows an invariant-coded failure after every listener ran', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, 'tokens.json'), watch: false })
    const ran: string[] = []
    ctx.on('oauth-tokens/updated', () => {
      ran.push('sync-boom')
      throw new Error('sync observer boom')
    })
    const asyncBoom = (): unknown => {
      ran.push('async-boom')
      return Promise.reject(new Error('async observer boom'))
    }
    ctx.on('oauth-tokens/updated', asyncBoom)
    ctx.on('oauth-tokens/updated', () => {
      ran.push('invariant')
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    const fourth = vi.fn()
    ctx.on('oauth-tokens/updated', fourth)
    await expect(ctx.oauthTokens.put('notion', bundle()))
      .rejects.toThrow(/forged relation/)
    expect(ran).toEqual(['sync-boom', 'async-boom', 'invariant'])
    expect(fourth).toHaveBeenCalledWith('notion')
    // The write committed before the fan-out threw.
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-1')
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('keeps the store usable after a fan-out failure', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, 'tokens.json'), watch: false })
    await seeded(ctx)
    ctx.on('oauth-tokens/updated', () => {
      throw new Error('sync observer boom')
    })
    await expect(ctx.oauthTokens.remove('notion')).resolves.toBeUndefined()
    expect(ctx.oauthTokens.list()).toEqual([])
  })
})
