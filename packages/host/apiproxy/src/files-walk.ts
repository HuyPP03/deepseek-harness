/**
 * Bounded file walk for the files domain: enumerates the mentionable regular
 * files under the session's working-set roots (the project cwd and the
 * attached reference projects). The bounds are protocol constants of the
 * files.list wire contract (depth 8, 1000 entries across all roots) — not
 * deployment tunables. The walk classifies entries from `readdir`
 * `withFileTypes` (no per-file stat), skips dot-prefixed entries and
 * `node_modules`, never follows symlinks (loop safety; a dangling link
 * names no file of the working set), and reads metadata only. A root that
 * vanished or is unreadable contributes nothing rather than failing the
 * listing; an aborted signal stops the walk and reports the partial result.
 */

import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** Maximum directory depth below a root (the root directory is depth 0). */
export const FILES_MAX_DEPTH = 8
/** Maximum number of files one walk returns, across every root. */
export const FILES_MAX_ENTRIES = 1000
/** Directory basenames never descended into, at any depth. */
const SKIPPED_DIRS = new Set(['node_modules'])

/** One walk root: a directory plus the root id its files carry. */
export interface FileWalkRoot {
  /** Canonical absolute directory to walk. */
  readonly dir: string
  /** Root id the files under this root carry ('workspace' or a reference basename). */
  readonly root: string
}

/** One mentionable file row, in the path forms the files.list wire serves. */
export interface FileWalkEntry {
  /** Absolute path of the file. */
  readonly path: string
  /** Path relative to its root, in the platform separator. */
  readonly relative: string
  /** The owning root's id. */
  readonly root: string
}

/** The walk outcome: bounded file rows plus the entry-bound report. */
export interface FileWalkResult {
  /** The walked files, in root order then deterministic name-sorted order. */
  readonly files: readonly FileWalkEntry[]
  /** True when FILES_MAX_ENTRIES cut the walk (more files exist). */
  readonly truncated: boolean
}

/**
 * Walks every root depth-first, name-sorted at each level (a deterministic
 * result for an unchanged tree). Dot-prefixed entries and symlinks are
 * skipped; a missing or unreadable root contributes nothing; the entry
 * bound stops the whole walk with `truncated: true`.
 * @param roots - The working-set roots, in the order their rows must appear.
 * @param signal - Optional abort; stops the walk and reports the partial result.
 * @returns The bounded file rows and whether the entry bound cut the walk.
 */
export async function walkFiles(
  roots: readonly FileWalkRoot[],
  signal?: AbortSignal,
): Promise<FileWalkResult> {
  const files: FileWalkEntry[] = []
  let truncated = false
  outer: for (const root of roots) {
    // Iterative DFS: one pending directory frame at a time, so a deep tree
    // costs O(depth) stack, not O(size).
    const stack: { dir: string; depth: number }[] = [{ dir: root.dir, depth: 0 }]
    let frame = stack.pop()
    while (frame !== undefined) {
      if (signal?.aborted) break outer
      const dirents = await listDir(frame.dir)
      if (dirents === undefined) {
        frame = stack.pop()
        continue
      }
      // Deterministic order: one ascending pass per level — files emit in
      // that order; directories are collected, then pushed reversed so the
      // LIFO stack walks them in the same ascending order.
      /* v8 ignore next -- arm distribution depends on the platform readdir
       * order, not fixture-portable; the determinism case pins it */
      const entries = [...dirents].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      const subdirs: string[] = []
      for (const dirent of entries) {
        const name = dirent.name
        if (name.startsWith('.') || SKIPPED_DIRS.has(name)) continue
        const path = join(frame.dir, name)
        if (dirent.isSymbolicLink()) continue
        if (dirent.isDirectory()) {
          if (frame.depth + 1 <= FILES_MAX_DEPTH) subdirs.push(path)
          continue
        }
        /* v8 ignore next -- non-regular entries (FIFOs, sockets) are not reproducible in a cross-platform fixture. */
        if (!dirent.isFile()) continue
        files.push({ path, relative: relative(root.dir, path), root: root.root })
        if (files.length >= FILES_MAX_ENTRIES) { truncated = true; break }
      }
      subdirs.reverse()
      for (const dir of subdirs) stack.push({ dir, depth: frame.depth + 1 })
      frame = stack.pop()
    }
    if (truncated) break
  }
  return { files, truncated }
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
