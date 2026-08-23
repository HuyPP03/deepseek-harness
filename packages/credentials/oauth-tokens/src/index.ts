/**
 * File-backed OAuth token bundle store: `$DSH_HOME/.connectors/oauth-tokens.json`.
 *
 * The document is a strict JSON mapping of owner id to
 * {@link OAuthTokenBundle}: an owner id outside the store's id shape, a
 * bundle without a non-empty access token, a non-finite expiry, or an
 * endpoint that is not a string is rejected rather than skipped, because a
 * silently unparseable bundle reads as "the token I stored has no effect".
 *
 * The storage discipline matches the sibling `credentials-local` provider:
 * the document is written `0600` under a `0700` directory, every write
 * re-reads the document under a cross-process writer lock before patching
 * only its own owner, external edits hot-publish through
 * `oauth-tokens/updated`, and each reload replaces the snapshot wholesale
 * so a removed owner never lingers in memory.
 *
 * The store is passive: it never refreshes, expires, or deletes a bundle on
 * a timer. The owner — a connector auth flow — re-puts a refreshed bundle or
 * removes it, and consumers read the current bundle at each use, so a
 * rotated grant reaches the next use without a restart.
 *
 * @module @deepseek-ai/dsh-credentials-oauth-tokens
 */

import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { canonicalizeWatchPath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { OAuthTokenBundle } from './types.ts'
export type { OAuthTokenBundle } from './types.ts'

/** Basename of the token document inside the connectors directory. */
export const TOKENS_FILENAME = 'oauth-tokens.json'

/** Owner id shape: a directory-safe lower-case token, same family as preset and server ids. */
const OWNER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

// This storage-discipline block intentionally mirrors credentials-local's
// (README: "The discipline mirrors credentials-local"); the clone is by design.
/* jscpd:ignore-start */
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Token document path; defaults to `.connectors/oauth-tokens.json` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}

/** Fully resolved store parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  filename: string
  watch: boolean
  debounceMs: number
}

/**
 * Resolve the runtime spec from plugin config: an explicit `path` wins,
 * otherwise the document lives at
 * `<harness home>/.connectors/oauth-tokens.json`.
 * @param config - raw plugin config.
 * @returns the resolved file location and watch behavior.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  return {
    filename: resolve(config.path ?? join(resolveDshHome(config.dshHome), '.connectors', TOKENS_FILENAME)),
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 100,
  }
}

/** Permission bits outside the owner; a token document must have none of them. */
const GROUP_OTHER_BITS = 0o077

/**
 * Reject a token document other OS users can read, before its contents are
 * read at all. The store creates and replaces the file at `0600`, but a
 * hand-written or externally generated one carries whatever umask produced
 * it, and silently serving tokens out of a world-readable file would make the
 * mode the store promises meaningless.
 *
 * POSIX only: Windows has no mode to inspect, so the check is skipped rather
 * than faked.
 * @param filename - absolute path of the document.
 * @throws when the file exists with group or other permission bits set.
 */
async function assertOwnerOnly(filename: string): Promise<void> {
  let mode: number
  try {
    mode = (await stat(filename)).mode
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  /* v8 ignore next -- POSIX coverage cannot take the Windows peer; native Windows coverage does. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows has no POSIX mode enforcement; POSIX behavior tests enforce this peer. */
  const offending = mode & GROUP_OTHER_BITS
  if (offending === 0) return
  throw new Error(
    `oauth-tokens: ${filename} is readable beyond its owner (mode ${(mode & 0o777).toString(8)});`
    + ` run "chmod 600 ${filename}" before starting again`,
  )
  /* v8 ignore stop */
}
/* jscpd:ignore-end */

/**
 * Whether one stored value is a well-formed bundle. The owner id is already
 * validated by the caller; every rejected field names itself, because a
 * wrong-typed bundle is still a secret the user meant to store.
 * @param owner - the owner id, quoted in errors.
 * @param value - the raw stored value.
 * @param filename - absolute path, quoted in errors.
 */
function assertBundle(owner: string, value: unknown, filename: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} must be an object`)
  }
  const bundle = value as Record<string, unknown>
  if (typeof bundle.accessToken !== 'string' || bundle.accessToken.length === 0) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} needs a non-empty accessToken`)
  }
  if (typeof bundle.expiresAt !== 'number' || !Number.isFinite(bundle.expiresAt)) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} needs a finite numeric expiresAt`)
  }
  if (typeof bundle.tokenEndpoint !== 'string' || bundle.tokenEndpoint.length === 0) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} needs a non-empty tokenEndpoint`)
  }
  if (typeof bundle.createdAt !== 'number' || !Number.isFinite(bundle.createdAt)) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} needs a finite numeric createdAt`)
  }
  if (typeof bundle.updatedAt !== 'number' || !Number.isFinite(bundle.updatedAt)) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} needs a finite numeric updatedAt`)
  }
  if (bundle.refreshToken !== undefined && (typeof bundle.refreshToken !== 'string' || bundle.refreshToken.length === 0)) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} has an empty refreshToken; omit it instead`)
  }
  if (bundle.scope !== undefined && typeof bundle.scope !== 'string') {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} has a non-string scope`)
  }
  if (bundle.clientId !== undefined && (typeof bundle.clientId !== 'string' || bundle.clientId.length === 0)) {
    throw new TypeError(`oauth-tokens: the bundle for "${owner}" in ${filename} has an empty clientId; omit it instead`)
  }
}

/**
 * Parse one token document into its bundles. The document is a strict
 * mapping of owner id to {@link OAuthTokenBundle}: a non-object root, an
 * owner id outside the store's id shape, and a malformed bundle are all
 * rejected rather than skipped. An empty document is an empty store.
 * @param text - the document's text.
 * @param filename - absolute path, quoted in errors.
 * @returns the parsed bundles, keyed by owner id.
 */
export function parseTokenDocument(text: string, filename: string): Map<string, OAuthTokenBundle> {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (error) {
    /* v8 ignore next -- JSON.parse only throws SyntaxError, an Error; the String(error) peer answers the catch type */
    throw new Error(`oauth-tokens: invalid document at ${filename}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new TypeError(`oauth-tokens: ${filename} must be a JSON object mapping owner id to token bundle`)
  }
  const bundles = new Map<string, OAuthTokenBundle>()
  for (const [owner, value] of Object.entries(root as Record<string, unknown>)) {
    if (!OWNER_ID.test(owner)) {
      throw new TypeError(`oauth-tokens: the owner id "${owner}" in ${filename} is not a valid id`)
    }
    assertBundle(owner, value, filename)
    bundles.set(owner, value as OAuthTokenBundle)
  }
  return bundles
}

/**
 * Validate one owner id at the store's API boundary.
 * @param ownerId - the owner id to validate.
 */
export function assertOwnerId(ownerId: string): void {
  if (!OWNER_ID.test(ownerId)) {
    throw new TypeError(`oauth-tokens: owner id "${ownerId}" is not a valid id (expected ${String(OWNER_ID)})`)
  }
}

// The store's file, watcher, and operation-chain machinery intentionally
// mirrors settings-file/credentials-local (README); the clone is by design.
/* jscpd:ignore-start */
/** File-backed OAuth token bundle store (`.connectors/oauth-tokens.json`). */
export class OAuthTokenStore extends Service {
  static Config: z<Config> = z.object({
    path: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
  })

  private readonly spec: ResolvedSpec
  /**
   * Raw text of the last read or persisted document; `undefined` while the
   * file is absent. Watcher events whose content equals this cache are no-ops,
   * which is also the self-write suppression.
   */
  private text: string | undefined
  /** Parsed document snapshot; replaced wholesale on every reload. */
  private bundles = new Map<string, OAuthTokenBundle>()
  /**
   * Single exclusive operation chain: watcher reloads and owner edits run
   * one at a time in queue order (settled tail), so an edit can never render
   * from text a concurrent reload is busy replacing.
   */
  private operations: Promise<void> = Promise.resolve()
  /** Set at dispose: refuse new writes and let in-flight work no-op. */
  private closed = false

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'oauthTokens')
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults in one explicit step either way.
    this.spec = resolveSpec(config)
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield async () => {
      // Drain: refuse new operations, then settle the queued ones so disposal
      // completes only once storage is quiescent.
      this.closed = true
      await this.operations
    }
    await this.loadInitial()
    if (!this.spec.watch) return
    const watcher = chokidarWatch(await canonicalizeWatchPath(this.spec.filename), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.spec.debounceMs,
        pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)),
      },
    })
    watcher.on('all', () => {
      if (this.closed) return
      this.queueRefresh()
    })
    watcher.on('ready', () => {
      // The initial load raced the watcher's own setup: a change written
      // between that read and the watcher becoming active never fires an
      // event. One reconcile at ready closes the gap.
      if (this.closed) return
      this.queueRefresh()
    })
    watcher.on('error', (error) => {
      this.ctx.logger.warn('oauth-tokens: watcher error on %s', this.spec.filename)
      this.ctx.logger.warn(error)
    })
    yield async () => {
      // Quiesce: stop accepting events, close the watcher, then wait out any
      // queued or in-flight operation so nothing publishes after disposal.
      this.closed = true
      await watcher.close()
      await this.operations
    }
  }

  /* jscpd:ignore-end */

  /**
   * The current bundle for one owner, read from the live snapshot.
   * @param ownerId - the owner to look up.
   * @returns the stored bundle, or `undefined` while the owner is unconfigured.
   */
  get(ownerId: string): OAuthTokenBundle | undefined {
    assertOwnerId(ownerId)
    return this.bundles.get(ownerId)
  }

  /**
   * The owner ids currently in the snapshot, sorted.
   * @returns the stored owner ids.
   */
  list(): readonly string[] {
    return [...this.bundles.keys()].sort()
  }

  /**
   * Durably store one owner's bundle, replacing any bundle the owner already
   * holds. The write folds in unobserved on-disk state under a cross-process
   * writer lock, so a concurrent writer or an external edit cannot be lost.
   * `createdAt` keeps the first stored value for this owner; `updatedAt` is
   * always the commit time.
   * @param ownerId - the owner to store for.
   * @param bundle - the bundle to store.
   */
  put(ownerId: string, bundle: OAuthTokenBundle): Promise<void> {
    if (!OWNER_ID.test(ownerId)) {
      return Promise.reject(new TypeError(`oauth-tokens: owner id "${ownerId}" is not a valid id (expected ${String(OWNER_ID)})`))
    }
    if (this.isClosed()) {
      return Promise.reject(new Error(`oauth-tokens is disposed: cannot put "${ownerId}"`))
    }
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`oauth-tokens was disposed before the queued put for "${ownerId}" ran`)
      }
      // The writer lock's exclusive create needs the parent to exist; 0700
      // because the tree holds user-private data.
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        await this.reconcileFromDisk()
        const existing = this.bundles.get(ownerId)
        const next: OAuthTokenBundle = {
          ...bundle,
          createdAt: existing?.createdAt ?? bundle.createdAt,
          updatedAt: Date.now(),
        }
        const entries: Record<string, OAuthTokenBundle> = {}
        for (const [owner, stored] of this.bundles) {
          if (owner !== ownerId) entries[owner] = stored
        }
        entries[ownerId] = next
        await this.commit(entries)
      })
    })
  }

  /**
   * Remove one owner's bundle; removing an absent owner is a no-op.
   * @param ownerId - the owner to remove.
   */
  remove(ownerId: string): Promise<void> {
    if (!OWNER_ID.test(ownerId)) {
      return Promise.reject(new TypeError(`oauth-tokens: owner id "${ownerId}" is not a valid id (expected ${String(OWNER_ID)})`))
    }
    if (this.isClosed()) {
      return Promise.reject(new Error(`oauth-tokens is disposed: cannot remove "${ownerId}"`))
    }
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`oauth-tokens was disposed before the queued remove for "${ownerId}" ran`)
      }
      // The writer lock's exclusive create needs the parent to exist.
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        await this.reconcileFromDisk()
        if (!this.bundles.has(ownerId)) return
        const entries: Record<string, OAuthTokenBundle> = {}
        for (const [owner, stored] of this.bundles) {
          if (owner !== ownerId) entries[owner] = stored
        }
        await this.commit(entries)
      })
    })
  }

  /* jscpd:ignore-start -- the operation-chain and reload lifecycle is the same
     reviewed contract as credentials-local, deliberately mirrored (prefer
     symmetry for parallel values); the two stores own different documents and
     a JSON vs YAML parser, so extracting a shared helper would couple their
     teardown semantics across packages for a handful of lines. */

  /** Queue one exclusive document operation behind every earlier one. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.then(operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  /** Queue a reload; only an invariant violation escaping the fan-out can reject it. */
  private queueRefresh(): void {
    void this.enqueue(() => this.refresh()).catch((error: unknown) => {
      // Only an invariant violation escaping the update fan-out can reject a
      // refresh; keep the operation queue alive and surface it as an error so
      // one poisoned commit cannot silently end hot reloading forever.
      this.ctx.logger.error('oauth-tokens: reload commit failed at %s', this.spec.filename)
      this.ctx.logger.error(error)
    })
  }

  /**
   * Boot read: an absent file is an empty store; an invalid one fails the
   * plugin's activation, because a token document that exists but cannot be
   * trusted must never be treated as "no tokens stored".
   */
  private async loadInitial(): Promise<void> {
    await assertOwnerOnly(this.spec.filename)
    let text: string
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    this.bundles = parseTokenDocument(text, this.spec.filename)
    this.text = text
  }

  /**
   * Re-read the document after a watcher event. Unchanged content (including
   * this store's own writes) is a no-op; an unreadable document keeps the
   * last good snapshot and warns — a live hot-reload must never take the
   * process down. An invariant violation escaping the fan-out is not a reload
   * failure and propagates to the queue's error surface.
   */
  private async refresh(): Promise<void> {
    if (this.closed) return
    try {
      await this.reconcileFromDisk()
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'INVARIANT') throw error
      this.ctx.logger.warn('oauth-tokens: reload failed at %s; keeping the last good document', this.spec.filename)
      this.ctx.logger.warn(error)
    }
  }

  /**
   * Commit one next-snapshot under the caller's writer lock: persist, update
   * the in-memory cache, and fan `oauth-tokens/updated` out only for the
   * owners whose stored bundle actually changed.
   * @param entries - the complete next owner-to-bundle mapping.
   */
  private async commit(entries: Record<string, OAuthTokenBundle>): Promise<void> {
    const next = new Map<string, OAuthTokenBundle>(Object.entries(entries))
    const text = JSON.stringify(Object.fromEntries(next), null, 2) + '\n'
    // 0600: a document holding tokens is never world-readable; the parent
    // tree holds user-private data, so it is 0700 as well.
    await writeFileAtomic(this.spec.filename, text, { mode: 0o600, dirMode: 0o700 })
    const changed: string[] = []
    for (const owner of new Set([...this.bundles.keys(), ...next.keys()])) {
      if (sameBundle(this.bundles.get(owner), next.get(owner))) continue
      changed.push(owner)
    }
    this.text = text
    this.bundles = next
    for (const owner of changed) this.notifyUpdated(owner)
  }

  /** Read the document from disk into the snapshot, replacing it wholesale. */
  private async reconcileFromDisk(): Promise<void> {
    await assertOwnerOnly(this.spec.filename)
    let text: string | undefined
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') text = undefined
      else throw error
    }
    if (text === this.text || this.isClosed()) return
    const next = text === undefined ? new Map<string, OAuthTokenBundle>() : parseTokenDocument(text, this.spec.filename)
    const changed: string[] = []
    for (const owner of new Set([...this.bundles.keys(), ...next.keys()])) {
      if (sameBundle(this.bundles.get(owner), next.get(owner))) continue
      changed.push(owner)
    }
    this.text = text
    this.bundles = next
    for (const owner of changed) this.notifyUpdated(owner)
  }

  /**
   * Fan `oauth-tokens/updated` out with contained listener failures: every
   * listener runs, and a sync throw or async rejection is logged without
   * changing the committed operation's outcome — except `INVARIANT`-coded
   * failures, which rethrow after every listener ran. The store calls this
   * only after the write or reload actually committed.
   * @param ownerId - the owner whose stored bundle changed.
   */
  private notifyUpdated(ownerId: string): void {
    let invariantFailure: unknown
    const args = ['oauth-tokens/updated', ownerId]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(...listenerArgs: unknown[]) => unknown>) {
      try {
        const returned = listener(ownerId)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.ctx.logger.warn('oauth-tokens: an oauth-tokens/updated listener for "%s" failed', ownerId)
            this.ctx.logger.warn(error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.ctx.logger.warn('oauth-tokens: an oauth-tokens/updated listener for "%s" failed', ownerId)
        this.ctx.logger.warn(error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }

  /* jscpd:ignore-end */
}

/**
 * Whether two stored bundles are structurally equal; both sides absent is
 * equality, as is one owner's unchanged re-commit.
 * @param left - the previous bundle, absent while unconfigured.
 * @param right - the next bundle, absent after removal.
 */
function sameBundle(left: OAuthTokenBundle | undefined, right: OAuthTokenBundle | undefined): boolean {
  /* v8 ignore next -- both callers iterate the union of the two snapshots' owners, so both sides absent is unreachable */
  if (left === undefined && right === undefined) return true
  if (left === undefined || right === undefined) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The file-backed OAuth token bundle store. */
    oauthTokens: OAuthTokenStore
  }
}

export default OAuthTokenStore
