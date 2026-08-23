import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OAuthTokenStore } from '../src/index.ts'
import type { OAuthTokenBundle } from '../src/types.ts'

// The atomic write is the gated asynchronous hold point inside a queued
// commit; gating it makes the dispose-versus-queued-operation race fully
// deterministic. The lock helper passes through so the gated operation still
// runs inside its real acquire/release cycle.
vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  let gate: Promise<void> = Promise.resolve()
  return {
    ...actual,
    writeFileAtomic: vi.fn(() => gate),
    __setGate: (next: Promise<void>) => {
      gate = next
    },
  }
})

async function setGate(next: Promise<void>): Promise<void> {
  const mocked = await import('@deepseek-ai/dsh-atomic-write') as unknown as { __setGate: (next: Promise<void>) => void }
  mocked.__setGate(next)
}

function bundle(): OAuthTokenBundle {
  const now = Date.now()
  return {
    accessToken: 'at-1',
    expiresAt: now + 3_600_000,
    tokenEndpoint: 'https://provider.example/token',
    createdAt: now,
    updatedAt: now,
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await setGate(Promise.resolve())
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('operation-drain teardown', () => {
  it('lets the in-flight commit land and fails the queued operations after disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-tokens-drain-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const ctx = new Context()
    const fiber = ctx.plugin(OAuthTokenStore, { path: join(dir, 'tokens.json'), watch: false })
    await fiber
    const store = ctx.oauthTokens

    let release!: () => void
    await setGate(new Promise<void>((resolveGate) => {
      release = resolveGate
    }))
    const first = store.put('notion', bundle())
    // Let the first task pass its liveness checks and park on the gate, so it
    // is genuinely in-flight when disposal begins.
    await new Promise(resolvePause => setTimeout(resolvePause, 5))
    // Attach the rejection handlers up front: the queued operations fail while
    // the drain is still awaited, before any later `await expect` could run.
    const queuedPutRejects = expect(store.put('slack', bundle())).rejects.toThrow(/disposed before the queued put/)
    const queuedRemoveRejects = expect(store.remove('notion')).rejects.toThrow(/disposed before the queued remove/)
    const disposal = fiber.dispose()
    // Give the drain disposer its first turn (set closed) before opening the gate.
    await new Promise(resolvePause => setTimeout(resolvePause, 10))
    release()
    await disposal

    await expect(first).resolves.toBeUndefined()
    await queuedPutRejects
    await queuedRemoveRejects
    // The in-flight commit landed; the queued operations did not run.
    expect(store.get('notion')?.accessToken).toBe('at-1')
    expect(store.list()).toEqual(['notion'])
  })
})
