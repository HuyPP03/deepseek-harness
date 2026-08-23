import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { OAuthTokenStore, parseTokenDocument, resolveSpec } from '../src/index.ts'
import type { OAuthTokenBundle } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-tokens-'))
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

// The parser under test owns the document's shape; overrides deliberately
// include malformed values, so they stay untyped here.
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

function updates(ctx: Context): string[] {
  const seen: string[] = []
  ctx.on('oauth-tokens/updated', (ownerId) => {
    seen.push(ownerId)
  })
  return seen
}

describe('resolveSpec', () => {
  it('defaults to .connectors/oauth-tokens.json under the harness home with watching on', () => {
    const spec = resolveSpec({ dshHome: '/custom/home' })
    expect(spec).toEqual({ filename: resolve('/custom/home/.connectors/oauth-tokens.json'), watch: true, debounceMs: 100 })
  })

  it('lets an explicit path win over the home', () => {
    const spec = resolveSpec({ path: '/etc/dsh/tokens.json', dshHome: '/ignored', watch: false, debounceMs: 5 })
    expect(spec).toEqual({ filename: resolve('/etc/dsh/tokens.json'), watch: false, debounceMs: 5 })
  })
})

describe('parseTokenDocument', () => {
  const file = '/tmp/tokens.json'

  it('parses a well-formed document', () => {
    const document = {
      notion: bundle(),
      'google-drive': bundle({ accessToken: 'at-2' }),
    }
    const parsed = parseTokenDocument(JSON.stringify(document), file)
    expect([...parsed.keys()].sort()).toEqual(['google-drive', 'notion'])
    expect(parsed.get('notion')?.accessToken).toBe('at-1')
  })

  it('treats an empty object as an empty store', () => {
    expect(parseTokenDocument('{}', file)).toEqual(new Map())
  })

  it('rejects non-JSON text with the filename', () => {
    expect(() => parseTokenDocument('not json', file)).toThrow(/oauth-tokens: invalid document at \/tmp\/tokens\.json/)
  })

  it('rejects a non-object root', () => {
    expect(() => parseTokenDocument('[1,2]', file)).toThrow(/must be a JSON object mapping owner id to token bundle/)
  })

  it('rejects an owner id outside the id shape', () => {
    expect(() => parseTokenDocument(JSON.stringify({ 'Bad Id': bundle() }), file)).toThrow(/is not a valid id/)
  })

  it('rejects a bundle without a non-empty access token', () => {
    expect(() => parseTokenDocument(JSON.stringify({ notion: bundle({ accessToken: '' }) }), file)).toThrow(/non-empty accessToken/)
  })

  it('rejects a non-finite expiry', () => {
    expect(() => parseTokenDocument(JSON.stringify({ notion: bundle({ expiresAt: 'soon' }) }), file)).toThrow(/finite numeric expiresAt/)
  })

  it('rejects a missing token endpoint', () => {
    const text = JSON.stringify({ notion: bundle({ tokenEndpoint: undefined }) })
    expect(() => parseTokenDocument(text, file)).toThrow(/non-empty tokenEndpoint/)
  })

  it('rejects an empty refreshToken (omit instead)', () => {
    expect(() => parseTokenDocument(JSON.stringify({ notion: bundle({ refreshToken: '' }) }), file)).toThrow(/omit it instead/)
  })

  it('rejects a bundle that is not an object', () => {
    expect(() => parseTokenDocument(JSON.stringify({ notion: 42 }), file)).toThrow(/must be an object/)
  })

  it('rejects a non-finite createdAt or updatedAt', () => {
    expect(() => parseTokenDocument(JSON.stringify({ notion: bundle({ createdAt: 'soon' }) }), file)).toThrow(/finite numeric createdAt/)
    expect(() => parseTokenDocument(JSON.stringify({ notion: bundle({ updatedAt: 'soon' }) }), file)).toThrow(/finite numeric updatedAt/)
  })

  it('rejects a non-string or empty clientId or scope', () => {
    expect(() => parseTokenDocument(JSON.stringify({ notion: bundle({ scope: 42 }) }), file)).toThrow(/non-string scope/)
    expect(() => parseTokenDocument(JSON.stringify({ notion: bundle({ clientId: '' }) }), file)).toThrow(/empty clientId/)
  })

  it('accepts a bundle with scope and clientId', () => {
    const parsed = parseTokenDocument(JSON.stringify({ notion: bundle({ scope: 'search:read page:read', clientId: 'app-1' }) }), file)
    expect(parsed.get('notion')?.scope).toBe('search:read page:read')
    expect(parsed.get('notion')?.clientId).toBe('app-1')
  })
})

describe('reads', () => {
  it('treats an absent file as an empty store', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, 'tokens.json'), watch: false })
    expect(ctx.oauthTokens.get('notion')).toBeUndefined()
    expect(ctx.oauthTokens.list()).toEqual([])
  })

  it('boots loud on a malformed document', async () => {
    const dir = await tempDir()
    const file = join(dir, 'tokens.json')
    await writeFile(file, '{oops', { mode: 0o600 })
    const ctx = new Context()
    const fiber = ctx.plugin(OAuthTokenStore, { path: file, watch: false })
    await expect(fiber).rejects.toThrow(/oauth-tokens: invalid document at/)
    cleanups.push(() => fiber.dispose().catch(() => undefined))
  })

  it('boots loud when the document path is a directory', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    await mkdir(path, { recursive: true, mode: 0o700 })
    const ctx = new Context()
    const fiber = ctx.plugin(OAuthTokenStore, { path, watch: false })
    await expect(fiber).rejects.toThrow(/ENOTDIR|EISDIR/)
    cleanups.push(() => fiber.dispose().catch(() => undefined))
  })

  it('boots loud when the document is inaccessible for a reason other than absence', async () => {
    if (process.platform === 'win32') return
    const dir = await tempDir()
    const file = join(dir, 'tokens.json')
    await writeFile(file, JSON.stringify({ notion: bundle() }) + '\n', { mode: 0o600 })
    await chmod(dir, 0o000)
    try {
      const ctx = new Context()
      const fiber = ctx.plugin(OAuthTokenStore, { path: file, watch: false })
      await expect(fiber).rejects.toThrow(/EACCES/)
      cleanups.push(() => fiber.dispose().catch(() => undefined))
    } finally {
      await chmod(dir, 0o700)
    }
  })

  it('refuses to boot on a document readable beyond its owner', async () => {
    /* v8 ignore next 12 -- POSIX-only mode check; the Windows peer is native coverage. */
    if (process.platform === 'win32') return
    const dir = await tempDir()
    const file = join(dir, 'tokens.json')
    await writeFile(file, JSON.stringify({ notion: bundle() }) + '\n', { mode: 0o644 })
    const ctx = new Context()
    const fiber = ctx.plugin(OAuthTokenStore, { path: file, watch: false })
    await expect(fiber).rejects.toThrow(/readable beyond its owner/)
    cleanups.push(() => fiber.dispose().catch(() => undefined))
  })
})

describe('writes', () => {
  it('stores, replaces, and removes one owner\'s bundle', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    const ctx = await boot({ path, watch: false })
    const seen = updates(ctx)

    await ctx.oauthTokens.put('notion', bundle())
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-1')
    expect(seen).toEqual(['notion'])

    // Re-putting re-stamps updatedAt, so the commit is a change and the event
    // fires again — the fan-out reports snapshot changes, not writes.
    await ctx.oauthTokens.put('notion', bundle({ accessToken: 'at-2' }))
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-2')
    expect(seen).toEqual(['notion', 'notion'])

    await ctx.oauthTokens.put('slack', bundle({ accessToken: 'at-s' }))
    expect(ctx.oauthTokens.list()).toEqual(['notion', 'slack'])

    await ctx.oauthTokens.remove('notion')
    expect(ctx.oauthTokens.get('notion')).toBeUndefined()
    expect(ctx.oauthTokens.list()).toEqual(['slack'])
    expect(seen).toEqual(['notion', 'notion', 'slack', 'notion'])

    // Removing an absent owner is a no-op.
    await ctx.oauthTokens.remove('absent')
    expect(ctx.oauthTokens.list()).toEqual(['slack'])

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(Object.keys(onDisk)).toEqual(['slack'])
  })

  it('keeps createdAt across re-put and sets updatedAt to the commit time', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, 'tokens.json'), watch: false })
    const first = bundle({ createdAt: 1000, updatedAt: 1000 })
    await ctx.oauthTokens.put('notion', first)
    const stored = ctx.oauthTokens.get('notion')
    expect(stored?.createdAt).toBe(1000)
    expect(stored?.updatedAt).toBeGreaterThanOrEqual(Date.now() - 1000)

    await ctx.oauthTokens.put('notion', { ...first, accessToken: 'at-3' })
    expect(ctx.oauthTokens.get('notion')?.createdAt).toBe(1000)
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-3')
  })

  it('writes the document 0600 under a 0700 directory', async () => {
    /* v8 ignore next 14 -- POSIX-only mode check; the Windows peer is native coverage. */
    if (process.platform === 'win32') return
    const dir = await tempDir()
    const path = join(dir, 'sub', 'tokens.json')
    const ctx = await boot({ path, watch: false })
    await ctx.oauthTokens.put('notion', bundle())
    const fileMode = (await stat(path)).mode & 0o777
    expect(fileMode).toBe(0o600)
    const dirMode = (await stat(join(dir, 'sub'))).mode & 0o777
    expect(dirMode).toBe(0o700)
  })

  it('rejects an invalid owner id at the API boundary', async () => {
    const dir = await tempDir()
    const ctx = await boot({ path: join(dir, 'tokens.json'), watch: false })
    expect(() => ctx.oauthTokens.get('Bad Id')).toThrow(/is not a valid id/)
    await expect(ctx.oauthTokens.put('Bad Id', bundle())).rejects.toThrow(/is not a valid id/)
    await expect(ctx.oauthTokens.remove('Bad Id')).rejects.toThrow(/is not a valid id/)
  })

  it('refuses new writes after disposal', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    const ctx = new Context()
    const fiber = ctx.plugin(OAuthTokenStore, { path, watch: false })
    await fiber
    const store = ctx.oauthTokens
    await fiber.dispose()
    await expect(store.put('notion', bundle())).rejects.toThrow(/disposed/)
    await expect(store.remove('notion')).rejects.toThrow(/disposed/)
  })
})

describe('concurrent writers', () => {
  it('folds in unobserved on-disk state under the writer lock', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    const ctx = await boot({ path, watch: false })
    await ctx.oauthTokens.put('notion', bundle({ accessToken: 'at-1' }))

    // An external writer adds another owner while this process is idle.
    const external = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    external.slack = bundle({ accessToken: 'at-s' })
    await writeFile(path, JSON.stringify(external, null, 2) + '\n', { mode: 0o600 })

    // The next put reconciles from disk first: the external owner survives.
    await ctx.oauthTokens.put('notion', bundle({ accessToken: 'at-2' }))
    expect(ctx.oauthTokens.get('notion')?.accessToken).toBe('at-2')
    expect(ctx.oauthTokens.get('slack')?.accessToken).toBe('at-s')

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(Object.keys(onDisk).sort()).toEqual(['notion', 'slack'])
  })

  it('serializes queued operations against each other', async () => {
    const dir = await tempDir()
    const path = join(dir, 'tokens.json')
    const ctx = await boot({ path, watch: false })
    await Promise.all([
      ctx.oauthTokens.put('notion', bundle({ accessToken: 'at-1' })),
      ctx.oauthTokens.put('slack', bundle({ accessToken: 'at-2' })),
      ctx.oauthTokens.put('linear', bundle({ accessToken: 'at-3' })),
    ])
    expect(ctx.oauthTokens.list()).toEqual(['linear', 'notion', 'slack'])
  })
})
