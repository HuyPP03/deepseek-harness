/**
 * Bounded file walk for the files domain: enumerates the mentionable files
 * and directories under the session's working-set roots (the project cwd and
 * the attached reference projects). The bounds are protocol constants of the
 * files.list wire contract, not deployment tunables: depth 8, a 20000-entry
 * scan bound (a pathological tree stops the walk with `truncated: true`),
 * and a 100-row result bound. The walk classifies entries from `readdir`
 * `withFileTypes` (no per-file stat), reads metadata only, and applies the
 * noise rule: every dot-prefixed entry (`.git`, `.env`, `.venv`, ...) plus
 * the curated directory-basename list in `files-skip.json` (node_modules,
 * `__pycache__`, venv, target, dist, ...) is skipped, and symlinks are
 * never followed (loop safety; a dangling link names no entry of the
 * working set). A root that vanished or is unreadable contributes
 * nothing rather than failing the listing; an aborted signal stops the walk
 * and reports the partial result.
 *
 * When a query is given, the host filters and ranks rows instead of the
 * client (case-insensitive: basename prefix beats path prefix beats
 * substring; ties go to the shorter, then byte-wise alphabetical, relative
 * path), so a long deep path matches even when the tree exceeds the result
 * bound: with a query the walk runs to its natural end (the scan bound and
 * depth bound still stop it) and the result bound caps the ranked rows.
 * Matching treats '/' and '\' as the same separator, so a typed query
 * matches platform-separator relatives on every platform. A query that ends
 * in a separator is a directory-prefix intent: after validating the prefix
 * as a safe relative path (no '..', no absolute segments), the walk prunes
 * to that subtree (the depth bound stays relative to the root). The query
 * only filters or prunes the walk's own enumeration — the host never
 * resolves it as an independent path.
 */

import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import fileSkip from './files-skip.json' with { type: 'json' }

/** Maximum directory depth below a root (the root directory is depth 0). */
export const FILES_MAX_DEPTH = 8
/** Maximum entries (files plus directories) one walk may scan, across all roots. */
export const FILES_MAX_SCAN = 20_000
/** Maximum rows one query result carries. */
export const FILES_MAX_RESULTS = 100
/**
 * Curated directory-basename skip list (the non-dot half of the noise rule);
 * see files-skip.json — it stays editable without touching the walk.
 */
const SKIPPED_DIRS: ReadonlySet<string> = new Set(fileSkip.directories)

/** Rank score for a basename-prefix match (best). */
const SCORE_BASE = 0
/** Rank score for a path-prefix match. */
const SCORE_PATH = 1
/** Rank score for a substring match (weakest). */
const SCORE_SUBSTRING = 2

/** One walk root: a directory plus the root id its rows carry. */
export interface FileWalkRoot {
  /** Canonical absolute directory to walk. */
  readonly dir: string
  /** Root id the rows under this root carry ('workspace' or a reference basename). */
  readonly root: string
}

/** One mentionable row (file or directory), in the path forms the files.list wire serves. */
export interface FileWalkEntry {
  /** Absolute path of the entry. */
  readonly path: string
  /** Path relative to its root, in the platform separator. */
  readonly relative: string
  /** The owning root's id. */
  readonly root: string
  /** True for a directory row (the menu renders a trailing slash). */
  readonly isDirectory: boolean
}

/** The walk outcome: bounded, ranked rows plus the scan-bound report. */
export interface FileWalkResult {
  /** The matched rows, ranked for the query (deterministic walk order when empty). */
  readonly files: readonly FileWalkEntry[]
  /** True when FILES_MAX_SCAN cut the walk (more entries exist, results are partial). */
  readonly truncated: boolean
}

/**
 * Walks every root depth-first, name-sorted at each level (a deterministic
 * order for an unchanged tree). `.git`, `node_modules` and symlinks are
 * skipped; a missing or unreadable root contributes nothing; with a query,
 * rows are filtered and ranked host-side (trailing-slash queries prune to
 * the validated prefix subtree, which keeps the depth bound relative to the
 * root); the scan bound stops the whole walk with `truncated: true`; the
 * result bound caps the rows — for a query it applies after ranking (the
 * walk runs to its natural end so no ranked match is lost), for a browse it
 * stops the walk early in deterministic order.
 * @param roots - The working-set roots, in the order their rows must appear.
 * @param signal - Optional abort; stops the walk and reports the partial result.
 * @param query - Optional case-insensitive filter/rank query (never resolved as a path; '/' and '\' are the same separator).
 * @returns The ranked rows (bounded) and whether the scan bound cut the walk.
 */
export async function walkFiles(
  roots: readonly FileWalkRoot[],
  signal?: AbortSignal,
  query?: string,
): Promise<FileWalkResult> {
  const q = (query ?? '').trim().toLowerCase().replace(/\\/gu, '/')
  const rows: FileWalkEntry[] = []
  let truncated = false
  let full = false
  let scanned = 0
  for (const root of roots) {
    let start = root.dir
    let startDepth = 0
    // Trailing-slash query: prune to the validated prefix subtree (a
    // '/'-less or mid-path query keeps the full scan — substring matches may
    // live anywhere in the tree, so pruning them would lose results).
    if (q.endsWith('/')) {
      const safe = safePrefix(q.slice(0, -1))
      if (safe === undefined) return empty()
      start = join(root.dir, safe)
      // The depth bound stays relative to the root under the prune.
      startDepth = safe.split(sep).length
      // The pruned prefix directory itself is mentionable (query 'src/'
      // lists 'src/'): emit it when it exists, before its children. A prune
      // implies a query, where the result bound applies after ranking.
      if (await listDir(start) !== undefined) {
        rows.push({ path: start, relative: relative(root.dir, start), root: root.root, isDirectory: true })
      }
    }
    // Iterative DFS: one pending directory frame at a time, so a deep tree
    // costs O(depth) stack, not O(size).
    const stack: { dir: string; depth: number }[] = [{ dir: start, depth: startDepth }]
    let frame = stack.pop()
    while (frame !== undefined) {
      if (signal?.aborted || truncated || full) break
      const dirents = await listDir(frame.dir)
      if (dirents === undefined) {
        frame = stack.pop()
        continue
      }
      // Deterministic order: one ascending pass per level — rows emit in
      // that order; directories are collected, then pushed reversed so the
      // LIFO stack walks them in the same ascending order.
      /* v8 ignore next -- arm distribution depends on the platform readdir
       * order, not fixture-portable; the determinism case pins it */
      const entries = [...dirents].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      const subdirs: string[] = []
      for (const dirent of entries) {
        scanned += 1
        if (scanned >= FILES_MAX_SCAN) { truncated = true; break }
        const name = dirent.name
        // Noise rule: every dot-prefixed entry (.git, .env, .venv, .agents,
        // ...) plus the curated list (node_modules, __pycache__, ...).
        if (name.startsWith('.') || SKIPPED_DIRS.has(name)) continue
        const path = join(frame.dir, name)
        if (dirent.isSymbolicLink()) continue
        const isDirectory = dirent.isDirectory()
        if (isDirectory) {
          // A directory beyond the depth bound is neither listed nor descended.
          if (frame.depth + 1 > FILES_MAX_DEPTH) continue
          subdirs.push(path)
        } else {
          /* v8 ignore next -- non-regular entries (FIFOs, sockets, devices) are not fixture-portable. */
          if (!dirent.isFile()) continue
        }
        const entry: FileWalkEntry = {
          path,
          relative: relative(root.dir, path),
          root: root.root,
          isDirectory,
        }
        if (q === '' || scoreOf(entry, q) !== undefined) {
          rows.push(entry)
          // The result bound stops the walk only for a browse (deterministic
          // order: the first rows win); a query walks to its natural end so
          // the rank — not the walk order — decides which rows are cut.
          if (q === '' && rows.length >= FILES_MAX_RESULTS) { full = true; break }
        }
      }
      subdirs.reverse()
      for (const dir of subdirs) stack.push({ dir, depth: frame.depth + 1 })
      frame = stack.pop()
    }
  }
  const files = q === '' ? rows : rank(rows, q).slice(0, FILES_MAX_RESULTS)
  return { files, truncated }
}

/**
 * Validates a query prefix as a safe relative directory path: non-empty,
 * relative segments only (no '..', no absolute, no empty segments). The
 * prefix is separator-normalized by the caller. Returns the path joined in
 * the platform separator, or undefined when the query is not a safe prefix.
 */
function safePrefix(prefix: string): string | undefined {
  if (prefix === '') return undefined
  const segments = prefix.split(/\/+/u)
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return undefined
  }
  return segments.join(sep)
}

/**
 * Score one row against the normalized query (case-insensitive), or undefined
 * for no match. The relative path is compared in its separator-normalized
 * ('/') form so a typed query matches on every platform. A directory matches
 * through its trailing-slash form so a query like 'src/' or 'src/m' finds
 * the folder 'src' and 'src/main'.
 */
function scoreOf(entry: FileWalkEntry, q: string): number | undefined {
  const rel = entry.relative.toLowerCase().split(sep).join('/')
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  if (entry.isDirectory) {
    const relSlash = rel + '/'
    if (base.startsWith(q)) return SCORE_BASE
    if (relSlash.startsWith(q)) return SCORE_PATH
    if (relSlash.includes(q)) return SCORE_SUBSTRING
    return undefined
  }
  if (base.startsWith(q)) return SCORE_BASE
  if (rel.startsWith(q)) return SCORE_PATH
  if (rel.includes(q)) return SCORE_SUBSTRING
  return undefined
}

/** Rank matched rows: score, then shorter path, then byte-wise alphabetical path. */
function rank(rows: FileWalkEntry[], q: string): FileWalkEntry[] {
  // The tie-break compares the same separator-normalized form scoreOf uses,
  // so the ordering is identical on every platform.
  const scored = rows.map(entry => ({
    entry,
    score: scoreOf(entry, q),
    normalized: entry.relative.toLowerCase().split(sep).join('/'),
  }))
  scored.sort((a, b) =>
    (a.score ?? 0) - (b.score ?? 0)
    || a.normalized.length - b.normalized.length
    || (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0))
  return scored.map(x => x.entry)
}

/** No results (an unsafe query prefix never matches rather than walking blind). */
function empty(): FileWalkResult {
  return { files: [], truncated: false }
}

/**
 * Reads one directory's entries. A missing or unreadable directory yields
 * undefined (the root vanished since the listing started, or the platform
 * denied the read) — the walk skips it rather than failing the listing.
 */
async function listDir(dir: string): Promise<readonly Dirent[] | undefined> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    // readdir is the only throwing call in the walk; a skipped subtree is
    // the contract for a vanished root, so nothing is logged here.
    return undefined
  }
}
