/**
 * Pure derivations of the inspector's Changes tab from a frozen conversation
 * snapshot: the latest diff card touching one file, path-matched against the
 * session's workspace root. The snapshot is structurally shared, so a
 * memo on the nodes reference recomputes only when the window actually moves.
 * @module @deepseek-ai/dsh-client-ui-file-inspector/client/changes
 */

import type { ConversationNode, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'

/** One diff hunk the Changes tab draws (the primitive's own contract). */
export type ChangesHunk = DiffHunk

/**
 * Resolve a tool diff's model-facing path the way the host bridge does:
 * absolute paths pass through, relative ones land under the session's
 * workspace root. An empty base fails closed (the relative path is returned
 * as-is, so it matches nothing absolute and the tab stays empty).
 * @param base - the session's workspace root (display-only absolute path).
 * @param path - the model-facing path the diff hunk carries.
 * @returns the absolute comparison form.
 */
export function resolveDiffPath(base: string | undefined, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
  if (base === undefined || base === '') return path
  return `${base.replace(/[\\/]+$/, '')}/${path}`
}

/**
 * The hunk's wire view, narrowed: a `card: 'diff'` view whose `diffs` is a
 * well-formed array of hunks, or null for the generic path. The view crosses
 * the wire and only the `card` string is validated, so a version mismatch can
 * deliver a diff card whose diffs is absent or malformed — the same stance
 * ui-tool's diffCardModel takes (reject the payload, never let a string in a
 * line-number seat reach the renderer).
 * @param view - the node's callView or resultView, unverified.
 * @returns the validated hunks, or null.
 */
function diffHunksOf(view: { card?: unknown; diffs?: unknown } | null): ChangesHunk[] | null {
  if (view === null || view.card !== 'diff' || !Array.isArray(view.diffs) || view.diffs.length === 0) return null
  const out: ChangesHunk[] = []
  for (const hunk of view.diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText, oldStart, newStart, lang } = hunk as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    if (oldStart !== undefined && typeof oldStart !== 'number') return null
    if (newStart !== undefined && typeof newStart !== 'number') return null
    if (lang !== undefined && typeof lang !== 'string') return null
    out.push({
      path,
      oldText,
      newText,
      ...(oldStart === undefined ? {} : { oldStart }),
      ...(newStart === undefined ? {} : { newStart }),
      ...(lang === undefined ? {} : { lang }),
    })
  }
  return out
}

/**
 * The latest diff card touching `path` in the frozen window: the highest-seq
 * settled tool result (top-level or a sub-dispatch of any depth) whose
 * result view — or, when the window cut left the result outside, call view —
 * carries a diff hunk resolving to the selected file. A card may diff several
 * files; only the selected file's hunks are returned, in card order.
 * @param nodes - the snapshot's node list (a structurally shared reference).
 * @param path - the selected file's canonical absolute path.
 * @param cwd - the session's workspace root for relative-path resolution.
 * @returns the matching hunks of the latest card, or null for the empty tab.
 */
export function latestFileDiffs(nodes: readonly ConversationNode[], path: string, cwd: string | undefined): ChangesHunk[] | null {
  const cards: { seq: number; hunks: ChangesHunk[] }[] = []
  const visit = (block: ToolCallBlock): void => {
    if ('kind' in block) {
      const hunks = diffHunksOf(block.resultView) ?? diffHunksOf(block.callView)
      if (hunks !== null) {
        const own = hunks.filter(h => resolveDiffPath(cwd, h.path) === path)
        if (own.length > 0) cards.push({ seq: block.seq, hunks: own })
      }
    }
    for (const sub of block.subCalls) visit(sub)
  }
  for (const node of nodes) {
    if (node.kind === 'tool-result') visit(node)
  }
  let best: { seq: number; hunks: ChangesHunk[] } | null = null
  for (const card of cards) {
    if (best === null || card.seq > best.seq) best = card
  }
  return best === null ? null : best.hunks
}

/**
 * Grammar hint for the Code tab from a file's extension: the curated set the
 * shared shiki loader already resolves (the primitive's alias table). A file
 * without a mapped extension renders plain text.
 * @param path - the file's canonical absolute path.
 * @returns a shiki-resolvable language id, or undefined for plain text.
 */
export function langForPath(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot === -1 || dot === path.length - 1) return undefined
  const ext = path.slice(dot + 1).toLowerCase()
  switch (ext) {
    case 'ts': case 'mts': case 'cts': return 'ts'
    case 'tsx': return 'tsx'
    case 'js': case 'mjs': case 'cjs': return 'js'
    case 'jsx': return 'jsx'
    case 'py': return 'py'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'rb': return 'ruby'
    case 'java': case 'kt': case 'swift': case 'c': case 'cpp': case 'cs': return ext === 'cpp' ? 'cpp' : ext
    case 'sh': case 'bash': case 'zsh': return 'sh'
    case 'json': case 'jsonc': return 'json'
    case 'yaml': case 'yml': return 'yaml'
    case 'toml': case 'ini': return ext
    case 'md': case 'markdown': return 'markdown'
    case 'mdx': return 'mdx'
    case 'html': case 'css': case 'scss': case 'less': case 'sql': case 'xml': case 'lua': return ext
    default: return undefined
  }
}

/** The preview seat's kinds, by extension. */
export type PreviewKind = 'markdown' | 'html' | 'image' | 'svg'

/**
 * Preview kind for the Preview tab from a file's extension. Images and SVG
 * render through the raw channel's own URL (the browser decodes the bytes),
 * HTML through a sandboxed frame on the same URL, and Markdown through the
 * shared renderer over the read text.
 * @param path - the file's canonical absolute path.
 * @returns the preview kind, or null when no preview surface exists.
 */
export function previewKindForPath(path: string): PreviewKind | null {
  const dot = path.lastIndexOf('.')
  if (dot === -1 || dot === path.length - 1) return null
  const ext = path.slice(dot + 1).toLowerCase()
  switch (ext) {
    case 'md': case 'markdown': return 'markdown'
    case 'html': case 'htm': return 'html'
    case 'svg': return 'svg'
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'bmp': case 'ico': return 'image'
    default: return null
  }
}
