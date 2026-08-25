/**
 * File-mention plugin, browser half: registers the '@' file source —
 * candidates from the files.list RPC (session-addressed: the host resolves
 * the project cwd plus the attached reference projects and filters/ranks the
 * walk's own enumeration with the live query, the client never submits a
 * path), and a pick lands the plain text '@<path> ' (the
 * plain-text-reference decision: the prompt ships the same literal and the
 * user message is the session log; see
 * .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md).
 * The insertion form is per-root: a main-project entry inserts its
 * workspace-relative path (the model addresses the workspace from its own
 * cwd), a reference entry its canonical absolute path (it lives outside the
 * model cwd, and reads are unrestricted in every confined mode). Directories
 * insert a trailing slash — a plain-text convention that marks the pick as a
 * folder for the model.
 *
 * The fetch cache is keyed by (session, query): the empty query (browse)
 * keeps the 15-second TTL because the file tree changes without any session
 * event, while a live query re-fetches with a short 2-second TTL (the host
 * filters, so each keystroke is one bounded walk). One in-flight fetch per
 * key; a new non-empty query aborts that session's earlier non-empty
 * in-flight fetches; a TTL expiry replaces the entry, a failure never
 * poisons the key (the next consumer retries), and connection/reset clears
 * everything — the host tree may differ across generations. The scope-birth
 * warm hook prewarms the session's browse key. The pick resolves the
 * insertion form from the matching settled cache entry (the menu row is a
 * short display form: workspace 'rel/path', reference 'rootname/rel/path').
 *
 * No reference codec and no lexicon roll: the input machine's text-reference
 * scanner matches word-ish names only (no dots or slashes), so file paths
 * take no chip decoration in the draft (known limitation; extending the
 * scanner is an input-machine change). Subagent scopes list nothing, like
 * the other sources; provider chats (a session whose agent runs a connector
 * preset) do too — they carry no project, so there are no workspace files to
 * mention (the connectors' published preset set is the authority, read at
 * call time).
 */

import type { ConnectionHandle, FileEntry, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, ISessions, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerCandidate, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** Required services: the trigger source face, the connection RPC, and the session projections. */
export const inject = ['inputTriggers', 'connection', 'sessions']

/** Browse-cache staleness bound: the file tree has no change feed. */
const FILES_BROWSE_TTL_MS = 15_000
/** Live-query re-fetch bound: each keystroke is one bounded host walk. */
const FILES_QUERY_TTL_MS = 2_000
/** Menu usability bound: the most relevant rows win. */
const FILES_MENU_MAX = 50

/** One (session, query) fetch: the shared promise plus its own abort handle. */
interface FileFetch {
  readonly promise: Promise<readonly FileEntry[]>
  readonly abort: AbortController
  /** Whether this key carries a live (non-empty) query. */
  readonly live: boolean
  readonly sessionId: SessionId
  /** Settle instant (TTL clock origin; refreshed when the fetch settles). */
  at: number
  /** Settled rows for the pick's insertion-form lookup (unset while in flight or on failure). */
  settled?: readonly FileEntry[]
}

/**
 * Client plugin body: register the '@' file source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const files = (ctx.get('connection') as ConnectionHandle).api.files
  const sessions = ctx.get('sessions') as ISessions
  // (session, query)-keyed fetch cache; single-flight per key. Plugin-closure
  // state: the fiber effect below is its teardown boundary.
  const fetches = new Map<string, FileFetch>()

  const keyOf = (sessionId: SessionId, query: string): string => `${sessionId}\u0000${query}`

  /**
   * Whether one session is a provider chat (its agent runs a connector preset):
   * provider chats carry no project, so they have no workspace files to mention.
   * Reads the list snapshot plus the connectors' published preset set at call
   * time (both settled by the time a user opens the '@' source).
   */
  const isProviderChat = (sessionId: SessionId): boolean => {
    const preset = sessions.list.getSnapshot().byId[sessionId]?.agentPreset
    if (preset === undefined) return false
    const provided = ctx.get('connectorPresetIds') as SnapshotStore<ReadonlySet<string>> | undefined
    return provided !== undefined && provided.getSnapshot().has(preset)
  }

  const fetchFiles = (sessionId: SessionId, query: string): Promise<readonly FileEntry[]> => {
    if (sessions.subagentAddress(sessionId) !== undefined) return Promise.resolve([])
    if (isProviderChat(sessionId)) return Promise.resolve([])
    const key = keyOf(sessionId, query)
    const live = query !== ''
    const ttl = live ? FILES_QUERY_TTL_MS : FILES_BROWSE_TTL_MS
    const existing = fetches.get(key)
    if (existing !== undefined && Date.now() - existing.at < ttl) return existing.promise
    if (existing !== undefined) {
      // TTL expired: drop the stale entry; the in-flight callers of the old
      // promise are not recalled (a stale listing is a correct listing).
      fetches.delete(key)
      existing.abort.abort()
    }
    if (live) {
      // A new keystroke supersedes the session's earlier live in-flight
      // fetches (their results still land in their own 2-second caches).
      for (const [k, entry] of [...fetches.entries()]) {
        if (k.startsWith(sessionId + '\u0000') && k !== key && entry.live) {
          fetches.delete(k)
          entry.abort.abort()
        }
      }
    }
    const abort = new AbortController()
    const promise = (async () => {
      const { result } = await files.list({ sessionId, ...(live ? { query } : {}) }, abort.signal)
      if (!result.ok) throw new Error(`files.list failed: ${result.error.code}: ${result.error.message}`)
      return result.value.files
    })()
    const entry: FileFetch = { promise, abort, live, sessionId, at: Date.now() }
    fetches.set(key, entry)
    // The single-flight settle hook mirrors the ui-skill catalog fetch
    // (the pattern's reference implementation); the differences stay
    // explicit at this source's settle hook (TTL clock, no lexicon
    // notification).
    /* jscpd:ignore-start */
    promise.then(
      (rows) => {
        entry.settled = rows
        entry.at = Date.now()
      },
      // A failed fetch must not poison the key: the next consumer retries.
      () => {
        if (fetches.get(key) === entry) fetches.delete(key)
      },
    )
    /* jscpd:ignore-end */
    return promise
  }

  // Aborts every in-flight fetch and drops the cache; a no-op on an empty map.
  const clearAll = (): void => {
    for (const entry of [...fetches.values()]) entry.abort.abort()
    fetches.clear()
  }

  /** The short display form: workspace relative, reference rooted at its basename, a trailing slash for directories. */
  const displayOf = (row: FileEntry): string =>
    (row.root === 'workspace' ? row.relative : `${row.root}/${row.relative}`) + (row.isDirectory ? '/' : '')

  /** One candidate row: the menu shows the display form; the pick maps it back to the insertion form. */
  const toCandidate = (row: FileEntry): InputTriggerCandidate => ({ name: displayOf(row) })

  /**
   * Filter+rank: case-insensitive over the relative path — a basename
   * prefix beats a path prefix beats a substring; ties go to the shorter,
   * then the byte-wise alphabetical, path. Mirrors the host's scoring
   * (separator-normalized: '/' and '\' are the same) so the re-order of the
   * host-ranked window is a no-op. The host already filtered the rows for
   * the query; this pass only re-orders the returned window.
   */
  const rank = (rows: readonly FileEntry[], query: string): readonly FileEntry[] => {
    const q = query.trim().toLowerCase().replace(/\\/gu, '/')
    if (q === '') return rows
    const scored: { row: FileEntry; score: number; key: string }[] = []
    for (const row of rows) {
      // Separator-normalized form: the host walks in the platform separator.
      const normalized = row.relative.toLowerCase().replace(/\\/gu, '/')
      const base = normalized.slice(normalized.lastIndexOf('/') + 1)
      // A directory matches through its trailing-slash form, mirroring the
      // host's filter (a query 'src/' lists the folder, not just its files).
      const relSlash = row.isDirectory ? normalized + '/' : normalized
      let score: number | undefined
      if (base.startsWith(q)) score = 0
      else if (relSlash.startsWith(q)) score = 1
      else if (relSlash.includes(q)) score = 2
      /* v8 ignore next -- the host already filters its window for the query; the re-score re-filters defensively. */
      if (score === undefined) continue
      scored.push({ row, score, key: normalized })
    }
    scored.sort((a, b) =>
      a.score - b.score
      || a.key.length - b.key.length
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return scored.map(x => x.row)
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'files',
    order: 1,
    async candidates(session, { query, signal }) {
      const trimmed = query.trim()
      const rows = await fetchFiles(session.sessionId, trimmed)
      // Superseded keystroke: the shared fetch stays warm, this caller yields.
      if (signal.aborted) return []
      return rank(rows, trimmed).slice(0, FILES_MENU_MAX).map(toCandidate)
    },
    warm(session) {
      // Fire-and-forget scope-birth prewarm of the browse key; the shared
      // fetch reports through candidates.
      fetchFiles(session.sessionId, '').catch(() => {})
    },
    onPick(pick) {
      // Plain-text-reference decision: the pick lands the '@<path> '
      // literal and the prompt ships the same text. The insertion form is
      // per-root — workspace-relative for the main project, absolute for a
      // reference, plus a trailing slash for a directory (the settled cache
      // carries both; a cleared cache degrades to the display form, which is
      // still a resolvable text mention).
      const { candidate, session } = pick
      const row = [...fetches.values()]
        .filter(entry => entry.sessionId === session.sessionId)
        .flatMap(entry => entry.settled ?? [])
        .find(row => displayOf(row) === candidate.name)
      const form = row === undefined
        ? candidate.name
        : (row.root === 'workspace' ? row.relative : row.path) + (row.isDirectory ? '/' : '')
      return { text: `@${form} ` }
    },
  }

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.on('connection/reset', clearAll)
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => {
      unregister()
      clearAll()
    }
  }, 'ui-file-mention: source')
}
