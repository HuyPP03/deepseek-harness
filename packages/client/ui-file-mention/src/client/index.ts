/**
 * File-mention plugin, browser half: registers the '@' file source —
 * candidates from the files.list RPC (session-addressed: the host resolves
 * the project cwd plus the attached reference projects, the client never
 * submits a path), and a pick lands the plain text '@<path> ' (the
 * plain-text-reference decision: the prompt ships the same literal and the
 * user message is the session log; see
 * .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md).
 * The insertion form is per-root: a main-project file inserts its
 * workspace-relative path (the model addresses the workspace from its own
 * cwd), a reference file its canonical absolute path (it lives outside the
 * model cwd, and reads are unrestricted in every confined mode).
 *
 * The catalog fetch is cached per session with a 15-second TTL: the file
 * tree changes without any session event, so a short TTL bounds staleness
 * instead of an invalidation feed. One in-flight fetch per key; a TTL expiry
 * replaces the entry, a failure never poisons the key (the next consumer
 * retries), and connection/reset clears everything — the host tree may
 * differ across generations. The scope-birth warm hook prewarms the session
 * key. The pick resolves the insertion form from the per-session settled
 * cache (the menu row is a short display form: workspace 'rel/path',
 * reference 'rootname/rel/path').
 *
 * No reference codec and no lexicon roll: the input machine's text-reference
 * scanner matches word-ish names only (no dots or slashes), so file paths
 * take no chip decoration in the draft (known limitation; extending the
 * scanner is an input-machine change). Subagent scopes list nothing, like
 * the other sources.
 */

import type { ConnectionHandle, FileEntry, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerCandidate, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** Required services: the trigger source face, the connection RPC, and the session projections. */
export const inject = ['inputTriggers', 'connection', 'sessions']

/** The fetch cache's staleness bound: the file tree has no change feed. */
const FILES_CACHE_TTL_MS = 15_000
/** Menu usability bound: the most relevant rows win. */
const FILES_MENU_MAX = 50

/** One session's file listing: the shared promise plus its own abort handle. */
interface FileFetch {
  readonly promise: Promise<readonly FileEntry[]>
  readonly abort: AbortController
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
  // Session-keyed fetch cache; single-flight per key. Plugin-closure state:
  // the fiber effect below is its teardown boundary.
  const fetches = new Map<SessionId, FileFetch>()

  const fetchFiles = (sessionId: SessionId): Promise<readonly FileEntry[]> => {
    if (sessions.subagentAddress(sessionId) !== undefined) return Promise.resolve([])
    const existing = fetches.get(sessionId)
    if (existing !== undefined && Date.now() - existing.at < FILES_CACHE_TTL_MS) return existing.promise
    if (existing !== undefined) {
      // TTL expired: drop the stale entry; the in-flight callers of the old
      // promise are not recalled (a stale listing is a correct listing).
      fetches.delete(sessionId)
      existing.abort.abort()
    }
    const abort = new AbortController()
    const promise = (async () => {
      const { result } = await files.list({ sessionId }, abort.signal)
      if (!result.ok) throw new Error(`files.list failed: ${result.error.code}: ${result.error.message}`)
      return result.value.files
    })()
    const entry: FileFetch = { promise, abort, at: Date.now() }
    fetches.set(sessionId, entry)
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
        if (fetches.get(sessionId) === entry) fetches.delete(sessionId)
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

  /**
   * One candidate row: the menu shows the short display form (workspace
   * relative, reference rooted at its basename); the pick maps it back to the
   * insertion form through the settled cache.
   */
  const toCandidate = (row: FileEntry): InputTriggerCandidate => ({
    name: row.root === 'workspace' ? row.relative : `${row.root}/${row.relative}`,
  })

  /**
   * Filter+rank: case-insensitive over the relative path — a basename
   * prefix beats a path prefix beats a substring; ties go to the shorter,
   * then the alphabetical, path. An empty query keeps the host's
   * deterministic order (root order, then name-sorted).
   */
  const rank = (rows: readonly FileEntry[], query: string): readonly FileEntry[] => {
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    const scored: { row: FileEntry; score: number; length: number }[] = []
    for (const row of rows) {
      const lower = row.relative.toLowerCase()
      const base = lower.slice(lower.lastIndexOf('/') + 1)
      let score: number | undefined
      if (base.startsWith(q)) score = 0
      else if (lower.startsWith(q)) score = 1
      else if (lower.includes(q)) score = 2
      if (score === undefined) continue
      scored.push({ row, score, length: row.relative.length })
    }
    scored.sort((a, b) =>
      a.score - b.score
      || a.length - b.length
      || a.row.relative.localeCompare(b.row.relative))
    return scored.map(x => x.row)
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'files',
    order: 1,
    async candidates(session, { query, signal }) {
      const rows = await fetchFiles(session.sessionId)
      // Superseded keystroke: the shared fetch stays warm, this caller yields.
      if (signal.aborted) return []
      return rank(rows, query).slice(0, FILES_MENU_MAX).map(toCandidate)
    },
    warm(session) {
      // Fire-and-forget scope-birth prewarm; the shared fetch reports
      // through candidates.
      fetchFiles(session.sessionId).catch(() => {})
    },
    onPick(pick) {
      // Plain-text-reference decision: the pick lands the '@<path> '
      // literal and the prompt ships the same text. The insertion form is
      // per-root — workspace-relative for the main project, absolute for a
      // reference (the settled cache carries both; a cleared cache degrades
      // to the display form, which is still a resolvable text mention).
      const { candidate, session } = pick
      const settled = fetches.get(session.sessionId)?.settled
      const row = settled?.find(f =>
        f.root === 'workspace' ? f.relative === candidate.name : `${f.root}/${f.relative}` === candidate.name)
      const form = row === undefined ? candidate.name : row.root === 'workspace' ? row.relative : row.path
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
