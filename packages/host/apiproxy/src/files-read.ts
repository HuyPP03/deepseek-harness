/**
 * Bounded file read for the files domain: the inspector's code surface
 * serves a decoded view of one file under the files.read wire contract.
 * The bounds are protocol constants, not deployment tunables: 2 MiB of
 * decoded bytes and 20000 lines — whichever the stream reaches first stops
 * the read and reports `truncated: true`, and a byte-bound cut drops a
 * trailing partial line so the content always ends on a line boundary. A
 * NUL byte in the leading 8 KiB marks the file binary (the view serves
 * empty content; the size still reports the whole file). Containment is
 * enforced here, not at the carrier: the requested path must resolve inside
 * the session's working set (project cwd or an attached reference project),
 * lexically and after symlink resolution, so a link inside a root that
 * points outside it is an escape, not a read.
 */

import type { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'

/** Maximum decoded bytes one read serves (2 MiB). */
export const FILE_READ_MAX_BYTES = 2 * 1024 * 1024
/** Maximum complete lines one read serves. */
export const FILE_READ_MAX_LINES = 20_000
/** A NUL within this many leading bytes marks the file binary. */
const BINARY_SNIFF_BYTES = 8 * 1024

/** The bounded read outcome for an admitted (contained) file path. */
export interface BoundedFileRead {
  /** Canonical absolute path that was read. */
  readonly path: string
  /** Decoded content within the bounds (empty for a binary or empty file). */
  readonly content: string
  /** Complete lines in the served content. */
  readonly lines: number
  /** True when a bound cut the read short of the file's end. */
  readonly truncated: boolean
  /** True when the leading bytes show a NUL; content is empty in that case. */
  readonly binary: boolean
  /** Whole-file size in bytes (independent of the served bounds). */
  readonly size: number
}

/** The files.read admission result: the bounded view, or the wire error code. */
export type SessionFileRead =
  | { ok: true; read: BoundedFileRead }
  | { ok: false; code: 'file-path-escape' | 'file-not-found' | 'file-is-directory' | 'file-unreadable' }

/**
 * Admission result for one requested path under the session's working-set
 * roots: the canonical target and whole-file size, or the stable error code.
 * Shared by the bounded text read and the raw byte channel, so both answer a
 * request from the same containment proof.
 */
export type SessionPathAdmission =
  | { ok: true; target: string; size: number }
  | { ok: false; code: 'file-path-escape' | 'file-not-found' | 'file-is-directory' | 'file-unreadable' }

/**
 * Resolve, classify, and stat one file under the session's working-set roots
 * without reading its content. A relative path resolves against the host
 * process cwd and is admitted only if that landing is inside a root (fail
 * closed).
 * @param roots - the root directories (canonical absolute paths).
 * @param rawPath - the client-submitted path (the list row's path form).
 * @returns the canonical target with its whole-file size, or the stable error code.
 */
export async function admitSessionPath(roots: readonly string[], rawPath: string): Promise<SessionPathAdmission> {
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(process.cwd(), rawPath)
  if (!containedIn(roots, resolved)) return { ok: false, code: 'file-path-escape' }
  let target: string
  try {
    target = await realpath(resolved)
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return { ok: false, code: 'file-not-found' }
    if (isCode(error, 'EACCES') || isCode(error, 'EPERM')) return { ok: false, code: 'file-unreadable' }
    throw error
  }
  if (!containedIn(roots, target)) return { ok: false, code: 'file-path-escape' }
  try {
    const stats = await lstat(target)
    if (stats.isDirectory()) return { ok: false, code: 'file-is-directory' }
    return { ok: true, target, size: stats.size }
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return { ok: false, code: 'file-not-found' }
    return { ok: false, code: 'file-unreadable' }
  }
}

/**
 * Resolve, classify, and bound-read one file under the session's working-set
 * roots.
 * @param roots - the root directories (canonical absolute paths).
 * @param rawPath - the client-submitted path (the list row's path form).
 * @returns the bounded view, or the stable error code the caller maps to its wire error.
 */
export async function readSessionFile(roots: readonly string[], rawPath: string): Promise<SessionFileRead> {
  const admission = await admitSessionPath(roots, rawPath)
  if (!admission.ok) return admission
  const { target, size } = admission
  try {
    const { content, lines, truncated, binary } = await readBounded(target, size)
    return { ok: true, read: { path: target, content, lines, truncated, binary, size } }
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT') || isCode(error, 'EISDIR')) return { ok: false, code: 'file-not-found' }
    return { ok: false, code: 'file-unreadable' }
  }
}

/** Lexical containment: the path equals a root or sits below it (separator-anchored). */
function containedIn(roots: readonly string[], path: string): boolean {
  return roots.some(root => path === root || path.startsWith(root + sep))
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

/**
 * Read a contained file within the bounds. The stream is destroyed the
 * moment a bound trips, so an oversized file never reads past
 * FILE_READ_MAX_BYTES. Truncation is judged against the stat size, not the
 * accumulation: a byte-bound cut lands on the bound byte (the read stream's
 * chunk size divides 2 MiB exactly, so the accumulation can stop with the
 * buffer at precisely the cap), and a line-bound cut lands on the bound-th
 * newline. A byte-bound mid-line cut drops the partial tail line so the
 * content ends on a line boundary.
 * @param target - the canonical path the admission step admitted.
 * @param size - the whole-file size from the stat that classified the path.
 * @returns the bounded view fields (the caller owns the path).
 */
async function readBounded(target: string, size: number): Promise<{
  content: string
  lines: number
  truncated: boolean
  binary: boolean
}> {
  const stream: Readable = createReadStream(target)
  try {
    const parts: Buffer[] = []
    let bytes = 0
    let newlines = 0
    let sniffed = 0
    let binary = false
    for await (const chunk of stream) {
      const buf = chunk as Buffer
      // The sniff window is the leading 8 KiB; a NUL found there breaks the
      // loop in the same iteration, so the window is probed at most once per
      // byte and never re-entered once set.
      if (sniffed < BINARY_SNIFF_BYTES) {
        const sniffEnd = Math.min(buf.length, BINARY_SNIFF_BYTES - sniffed)
        if (buf.subarray(0, sniffEnd).includes(0)) binary = true
        sniffed += sniffEnd
      }
      parts.push(buf)
      bytes += buf.length
      newlines += countNewlines(buf)
      if (binary || bytes >= FILE_READ_MAX_BYTES || newlines >= FILE_READ_MAX_LINES) break
    }
    let content = Buffer.concat(parts).subarray(0, FILE_READ_MAX_BYTES)
    if (binary) return { content: '', lines: 0, truncated: false, binary: true }
    if (newlines >= FILE_READ_MAX_LINES) {
      // Cut just after the bound-th newline: that byte lands on a line boundary.
      let seen = 0
      let cut = content.length
      for (let i = 0; i < content.length; i++) {
        if (content[i] === 0x0a && ++seen === FILE_READ_MAX_LINES) {
          cut = i + 1
          break
        }
      }
      content = content.subarray(0, cut)
    }
    // The whole file was served iff nothing cut it short: a file ending
    // exactly on a bound (last byte at 2 MiB, or on the bound-th newline) is
    // complete, so the comparison against the stat size is exact.
    const truncated = size > content.length
    if (truncated && content.length > 0 && content[content.length - 1] !== 0x0a) {
      // A byte-bound mid-line cut: drop the partial tail line (keep its
      // predecessor's newline: the index of the last newline marks its end).
      const last = content.lastIndexOf(0x0a)
      content = content.subarray(0, last === -1 ? 0 : last + 1)
    }
    const text = content.toString('utf8')
    return { content: text, lines: lineCount(text), truncated, binary: false }
  } finally {
    stream.destroy()
  }
}

function countNewlines(buf: Buffer): number {
  let count = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) count++
  }
  return count
}

/** Complete lines in a text: a trailing newline ends its line rather than opening a phantom one. */
function lineCount(text: string): number {
  if (text === '') return 0
  let count = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) count++
  }
  return text.endsWith('\n') ? count - 1 : count
}
