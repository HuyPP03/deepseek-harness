// DiffBlock: the inline-diff surface for a file mutation (write/edit) — a copy
// control over one or more per-file hunks, each a bold path header followed by
// a line-aligned unified body (neutral context, removed, added). A capable view
// numbers gutters from the hunk's 1-based starts, syntax-highlights each side
// through the shared shiki path, and marks the exact changed run inside a
// modified line with a stronger wash than the whole-line side color. Output
// never soft-wraps — an aligned source line keeps its indentation and scrolls
// horizontally instead of folding. Colors resolve through --dsw-* tokens;
// geometry mirrors CodeBlock.

import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import clsx from 'clsx'
import { diffLines, diffWordsWithSpace } from 'diff'
import { ExpandCollapseToggle } from './ExpandCollapseToggle.tsx'
import { writeClipboard } from './clipboard.ts'
import {
  grammarLoadCount,
  highlightLines,
  subscribeGrammarLoaded,
  type HighlightSpan,
} from './markdown/highlight.ts'
import css from './DiffBlock.module.css'

/**
 * Output lines shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a diff card and a terminal card cut a
 * long body at the same place.
 */
export const DEFAULT_DIFF_MAX_LINES = 16

/**
 * Soft cap on a single line's length before the intra-line word diff is skipped.
 * A pathological one-line rewrite (minified JSON, a pasted base64 blob) would
 * otherwise spend a frame walking every character; past this length the row
 * still gets the whole-line wash, just not the stronger mark.
 */
export const INTRA_LINE_MAX = 2000

/**
 * One file's change, in the shape {@link DiffBlock} draws. Structurally the
 * render-intent contract's `FileDiff`, redeclared here so this primitive stays
 * free of the tool contract (the terminal card's decoupling, applied to diffs).
 */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header (the tool's model-facing path). */
  path: string
  /** Prior content, or `null` for a new file / an overwrite (nothing on the removed side). */
  oldText: string | null
  /** Content after the change (the added side). */
  newText: string
  /** 1-based line number where this hunk begins on the removed side (first context or removed line). */
  oldStart?: number | undefined
  /** 1-based line number where this hunk begins on the added side (first context or added line). */
  newStart?: number | undefined
  /** Grammar hint for the shared highlighter (a file-extension-derived language id). */
  lang?: string | undefined
}

/**
 * Display copy for the diff surface; the owner passes localized labels (this
 * package is cordis-free, so copy arrives via props). Every field defaults to
 * the built-in English value, so existing consumers render unchanged.
 */
export interface DiffBlockLabels {
  /** Copy-button idle label. */
  copy: string
  /** Copy-button label during the post-copy confirmation window. */
  copied: string
  /** Collapse-toggle aria label while expanded. */
  collapseAria: string
  /** Expand-toggle aria label while capped, given the hidden line count. */
  expandAria: (hidden: number) => string
  /** Collapse-toggle text while expanded. */
  collapse: string
  /** Expand-toggle text while capped, given the hidden line count. */
  expand: (hidden: number) => string
}

const DEFAULT_DIFF_LABELS: DiffBlockLabels = {
  copy: 'Copy',
  copied: 'Copied',
  collapseAria: 'Collapse diff',
  expandAria: hidden => `Expand the remaining ${hidden} diff lines`,
  collapse: 'Collapse',
  expand: hidden => `… ${hidden} more lines`,
}

export interface DiffBlockProps {
  /** One entry per applied hunk, in file order; empty renders nothing. */
  diffs: DiffHunk[]
  /** Height cap in body lines before the middle collapses (default {@link DEFAULT_DIFF_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Display copy for the copy and collapse/expand controls. */
  labels?: Partial<DiffBlockLabels> | undefined
}

/** A character range inside one side of a modified line (0-based, end-exclusive). */
interface StrongRange {
  start: number
  end: number
}

/**
 * A single rendered body row. Chrome rows (`path`/`gap`) carry only text; change
 * and context rows carry the side they number, the optional gutter, and any
 * intra-line strong ranges for a modified line. `hunk` and `side` keep the
 * per-side highlight grouping in step with the flat row list.
 */
interface DiffRow {
  kind: 'path' | 'gap' | 'ctx' | 'del' | 'add'
  text: string
  /** 1-based gutter number when the producing hunk stamped a start; absent = no gutter. */
  lineNo?: number
  /** Language hint of the producing hunk (shared across its rows for highlighting). */
  lang?: string
  /** Intra-line changed ranges on this side; absent = whole-line wash only. */
  strong?: StrongRange[]
  /** Index of the producing hunk (chrome rows: the hunk that follows them). */
  hunk: number
  /** The side the row's text belongs to; a context row belongs to both. */
  side: 'old' | 'new' | 'both'
}

/** Local exhaustiveness helper — this package does not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable diff row kind: ${String(value)}`)
}

/**
 * Split a side's text into its content lines. Empty text is zero lines (a full
 * deletion's `newText` or a create's absent `oldText` side draws nothing), and a
 * single trailing newline is a line terminator rather than an extra empty line —
 * the same terminator rule TerminalBlock applies to command output. An interior
 * blank line (a genuine `\n\n`) survives.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * Compute the intra-line strong ranges for one side of a modified line pair.
 * Skipped when either side exceeds {@link INTRA_LINE_MAX}.
 * @param oldLine - the removed line's text.
 * @param newLine - the added line's text.
 * @returns the ranges on each side, or empty arrays when the word diff is skipped.
 */
function intraLineRanges(oldLine: string, newLine: string): { old: StrongRange[]; neu: StrongRange[] } {
  if (oldLine.length > INTRA_LINE_MAX || newLine.length > INTRA_LINE_MAX) {
    return { old: [], neu: [] }
  }
  const old: StrongRange[] = []
  const neu: StrongRange[] = []
  let oldPos = 0
  let newPos = 0
  for (const part of diffWordsWithSpace(oldLine, newLine)) {
    const len = part.value.length
    if (part.added) {
      neu.push({ start: newPos, end: newPos + len })
      newPos += len
    } else if (part.removed) {
      old.push({ start: oldPos, end: oldPos + len })
      oldPos += len
    } else {
      oldPos += len
      newPos += len
    }
  }
  return { old, neu }
}

/**
 * Emit one same-length remove/add block as paired modified rows (each pair
 * carrying intra-line marks), advancing the gutter cursors by the block length.
 * @param oldLines - the removed block's lines.
 * @param newLines - the added block's lines (same length).
 * @param oldNo - next 1-based gutter on the removed side, or undefined when unnumbered.
 * @param newNo - next 1-based gutter on the added side, or undefined when unnumbered.
 * @param lang - the hunk's language hint.
 * @param hunk - the producing hunk's index.
 * @param rows - the row list to append to.
 * @returns the advanced gutter cursors.
 */
function pushPaired(
  oldLines: string[],
  newLines: string[],
  oldNo: number | undefined,
  newNo: number | undefined,
  lang: string | undefined,
  hunk: number,
  rows: DiffRow[],
): { oldNo: number | undefined; newNo: number | undefined } {
  oldLines.forEach((oldLine, i) => {
    // The caller admits this path only for equal-length blocks, so the
    // partner index is always in range.
    /* v8 ignore next -- equal-length blocks: the partner index is in range. */
    const newLine = newLines[i] ?? ''
    const ranges = intraLineRanges(oldLine, newLine)
    rows.push({
      kind: 'del',
      text: oldLine,
      hunk,
      side: 'old',
      ...(oldNo === undefined ? {} : { lineNo: oldNo + i }),
      ...(lang === undefined ? {} : { lang }),
      ...(ranges.old.length > 0 ? { strong: ranges.old } : {}),
    })
    rows.push({
      kind: 'add',
      text: newLine,
      hunk,
      side: 'new',
      ...(newNo === undefined ? {} : { lineNo: newNo + i }),
      ...(lang === undefined ? {} : { lang }),
      ...(ranges.neu.length > 0 ? { strong: ranges.neu } : {}),
    })
  })
  return {
    oldNo: oldNo === undefined ? undefined : oldNo + oldLines.length,
    newNo: newNo === undefined ? undefined : newNo + newLines.length,
  }
}

/**
 * Flatten one hunk into line-aligned body rows. A create (`oldText: null`) is
 * add-only; a full deletion (`newText: ''`) is del-only; every other case runs a
 * line diff so neutral context, removes, and adds interleave the way a reader
 * expects. A same-length remove/add adjacency also carries intra-line strong
 * ranges (a modified line pair), and an unbalanced one falls to separate
 * removed/added blocks.
 * @param diff - the hunk to flatten.
 * @param hunk - the hunk's index in the card.
 * @param rows - the row list to append to.
 * @returns the +/- line totals contributed by this hunk.
 */
function flattenHunk(diff: DiffHunk, hunk: number, rows: DiffRow[]): { added: number; removed: number } {
  const lang = diff.lang
  let oldNo = diff.oldStart
  let newNo = diff.newStart
  let added = 0
  let removed = 0

  if (diff.oldText === null) {
    const lines = contentLines(diff.newText)
    lines.forEach((text, i) => {
      rows.push({
        kind: 'add',
        text,
        hunk,
        side: 'new',
        ...(newNo === undefined ? {} : { lineNo: newNo + i }),
        ...(lang === undefined ? {} : { lang }),
      })
    })
    return { added: lines.length, removed: 0 }
  }

  if (diff.newText === '') {
    const lines = contentLines(diff.oldText)
    lines.forEach((text, i) => {
      rows.push({
        kind: 'del',
        text,
        hunk,
        side: 'old',
        ...(oldNo === undefined ? {} : { lineNo: oldNo + i }),
        ...(lang === undefined ? {} : { lang }),
      })
    })
    return { added: 0, removed: lines.length }
  }

  // `diffLines` parts keep their trailing newline (except the final one); strip
  // each part through contentLines so the terminator rule still holds.
  const parts = diffLines(diff.oldText, diff.newText)
  let pendingDel: string[] | undefined
  const flushPending = (neu: string[] | undefined) => {
    if (pendingDel === undefined) return
    if (neu === undefined || pendingDel.length !== neu.length) {
      pendingDel.forEach((text, i) => {
        rows.push({
          kind: 'del',
          text,
          hunk,
          side: 'old',
          ...(oldNo === undefined ? {} : { lineNo: oldNo + i }),
          ...(lang === undefined ? {} : { lang }),
        })
      })
      removed += pendingDel.length
      oldNo = oldNo === undefined ? undefined : oldNo + pendingDel.length
      if (neu !== undefined) {
        neu.forEach((text, i) => {
          rows.push({
            kind: 'add',
            text,
            hunk,
            side: 'new',
            ...(newNo === undefined ? {} : { lineNo: newNo + i }),
            ...(lang === undefined ? {} : { lang }),
          })
        })
        added += neu.length
        newNo = newNo === undefined ? undefined : newNo + neu.length
      }
      pendingDel = undefined
      return
    }
    const advanced = pushPaired(pendingDel, neu, oldNo, newNo, lang, hunk, rows)
    removed += pendingDel.length
    added += neu.length
    oldNo = advanced.oldNo
    newNo = advanced.newNo
    pendingDel = undefined
  }

  for (const part of parts) {
    const lines = contentLines(part.value)
    if (part.removed) {
      // Hold a remove block so a following add of the same length can pair.
      flushPending(undefined)
      pendingDel = lines
      continue
    }
    if (part.added) {
      if (pendingDel !== undefined) {
        flushPending(lines)
      } else {
        lines.forEach((text, i) => {
          rows.push({
            kind: 'add',
            text,
            hunk,
            side: 'new',
            ...(newNo === undefined ? {} : { lineNo: newNo + i }),
            ...(lang === undefined ? {} : { lang }),
          })
        })
        added += lines.length
        newNo = newNo === undefined ? undefined : newNo + lines.length
      }
      continue
    }
    // Neutral context: flush any hanging delete first, then emit ctx rows that
    // advance BOTH gutters (the line exists on both sides). Prefer the new-side
    // cursor when both are known; fall back to the old-side cursor for a
    // hunk that never stamped newStart.
    flushPending(undefined)
    for (const text of lines) {
      const lineNo = newNo ?? oldNo
      rows.push({
        kind: 'ctx',
        text,
        hunk,
        side: 'both',
        ...(lineNo === undefined ? {} : { lineNo }),
        ...(lang === undefined ? {} : { lang }),
      })
      if (oldNo !== undefined) oldNo += 1
      if (newNo !== undefined) newNo += 1
    }
  }
  flushPending(undefined)
  return { added, removed }
}

/**
 * Flatten the hunks into the body's rows plus the footer counts. A path header
 * opens each new file; a same-file second hunk (a scattered edit) opens with a
 * `⋯` gap instead of repeating the path. The file count is of DISTINCT paths,
 * matching the TUI diff card's footer, so two hunks in one file read as
 * `1 file` on both front ends.
 * @param diffs - the hunks to render.
 * @returns the body rows, the +/- totals, and the distinct-file count.
 */
function buildRows(diffs: DiffHunk[]): { rows: DiffRow[]; added: number; removed: number; files: number } {
  const rows: DiffRow[] = []
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  let prevPath: string | undefined
  diffs.forEach((diff, hunk) => {
    paths.add(diff.path)
    if (diff.path !== prevPath) rows.push({ kind: 'path', text: diff.path, hunk, side: 'both' })
    else rows.push({ kind: 'gap', text: '⋯', hunk, side: 'both' })
    prevPath = diff.path
    const counts = flattenHunk(diff, hunk, rows)
    added += counts.added
    removed += counts.removed
  })
  return { rows, added, removed, files: paths.size }
}

/**
 * The diff text a reader copies: each row's `-`/`+`/context/path/gap prefix and
 * its content, exactly what the card shows. The removed and added blocks are the
 * change; the path headers keep a multi-file copy attributable.
 * @param rows - the flattened body rows.
 * @returns the diff as plain text.
 */
function copyText(rows: DiffRow[]): string {
  return rows.map((row) => {
    switch (row.kind) {
      case 'del': return `- ${row.text}`
      case 'add': return `+ ${row.text}`
      case 'ctx': return `  ${row.text}`
      case 'path': return row.text
      case 'gap': return row.text
      /* v8 ignore next -- closed-union backstop; only reached if a row kind is forged */
      default: return assertNever(row.kind)
    }
  }).join('\n')
}

/**
 * Split highlighted (or plain) runs across the intra-line strong ranges so each
 * changed character sits inside a stronger mark without losing its token color.
 * @param text - the row's full text.
 * @param spans - shiki runs for the row, or `undefined` for the plain fallback.
 * @param strong - the changed character ranges on this side.
 * @param markClass - the CSS module class for the stronger mark.
 * @returns the row's children.
 */
function paintContent(
  text: string,
  spans: readonly HighlightSpan[] | undefined,
  strong: readonly StrongRange[] | undefined,
  markClass: string | undefined,
): ReactNode {
  const runs = spans ?? [{ text, style: {} }]
  if (strong === undefined || markClass === undefined) {
    return runs.map((span, index) => (
      <span key={index} style={span.style}>{span.text}</span>
    ))
  }
  // Walk each highlighted run against the strong ranges, splitting at every
  // boundary so a mark never straddles a token color and a token color never
  // swallows a mark.
  const out: ReactNode[] = []
  let cursor = 0
  let key = 0
  for (const span of runs) {
    let local = 0
    while (local < span.text.length) {
      const abs = cursor + local
      const covering = strong.find(range => abs >= range.start && abs < range.end)
      let runEnd: number
      if (covering === undefined) {
        // Advance to the next strong start, or the end of this span.
        runEnd = span.text.length
        for (const range of strong) {
          const rel = range.start - cursor
          if (rel > local && rel < runEnd) runEnd = rel
        }
      } else {
        runEnd = Math.min(span.text.length, covering.end - cursor)
      }
      const node = <span key={key} style={span.style}>{span.text.slice(local, runEnd)}</span>
      out.push(covering === undefined ? node : <span key={`m${key}`} className={markClass}>{node}</span>)
      key += 1
      local = runEnd
    }
    cursor += span.text.length
  }
  return out
}

/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({ diffs, maxLines = DEFAULT_DIFF_MAX_LINES, className, labels }: DiffBlockProps) {
  const { rows, added, removed, files } = useMemo(() => buildRows(diffs), [diffs])
  const copy = useMemo(
    () => (labels === undefined ? DEFAULT_DIFF_LABELS : { ...DEFAULT_DIFF_LABELS, ...labels }),
    [labels],
  )
  // Re-render when a lazy grammar finishes loading, so a diff card that showed
  // plain text while its language's grammar imported picks up highlighting. The
  // snapshot value is opaque; only its change across renders drives the memo.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  // Per-side highlight: within one hunk, the old side (context + removed) and
  // the new side (context + added) are each joined and tokenized in one pass,
  // so a multi-line string or comment keeps its grammar context, exactly as the
  // read card highlights its window. The two sides are different texts, so a
  // single shared pass was never an option.
  const highlighted = useMemo(() => {
    const out: (readonly HighlightSpan[] | undefined)[] = Array.from({ length: rows.length })
    const groups: { lang: string; oldSide: Array<readonly [number, string]>; newSide: Array<readonly [number, string]> }[] = []
    rows.forEach((row, index) => {
      if (row.kind === 'path' || row.kind === 'gap' || row.lang === undefined) return
      let group = groups[row.hunk]
      if (group === undefined) group = groups[row.hunk] = { lang: row.lang, oldSide: [], newSide: [] }
      if (row.side !== 'new') group.oldSide.push([index, row.text])
      if (row.side !== 'old') group.newSide.push([index, row.text])
    })
    for (const group of groups) {
      const oldRuns = highlightLines(group.oldSide.map(([, text]) => text).join('\n'), group.lang)
      group.oldSide.forEach(([index], k) => { out[index] = oldRuns?.[k] })
      const newRuns = highlightLines(group.newSide.map(([, text]) => text).join('\n'), group.lang)
      group.newSide.forEach(([index], k) => { out[index] = newRuns?.[k] })
    }
    return out
    // `loaded` is an opaque counter whose change forces a re-highlight.
  }, [rows, loaded])

  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  if (rows.length === 0) return null

  const hidden = rows.length - maxLines
  const capped = hidden > 0 && !expanded
  // Same split arithmetic as TerminalBlock and the TUI transcript's collapsed
  // card, so a body's head and tail slices agree across the front ends.
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const head = capped ? rows.slice(0, headLines) : rows
  const tail = capped ? rows.slice(rows.length - tailLines) : []
  // Numbered gutters only appear when at least one body row carries a line
  // number — otherwise the sign column sits flush left like the legacy card.
  const numbered = rows.some(row => row.lineNo !== undefined)

  const renderRow = (row: DiffRow, index: number, offset: number) => {
    const absolute = offset + index
    if (row.kind === 'path' || row.kind === 'gap') {
      return (
        <div
          key={absolute}
          className={clsx(css.line, row.kind === 'path' ? css.path : css.gap)}
        >
          {row.text}
        </div>
      )
    }
    const markClass = row.kind === 'del'
      ? css.strongDel
      : row.kind === 'add'
        ? css.strongAdd
        : undefined
    const sign = row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ' '
    return (
      <div
        key={absolute}
        className={clsx(
          css.line,
          row.kind === 'del' && css.del,
          row.kind === 'add' && css.add,
        )}
      >
        {numbered && (
          <span className={css.gutter} aria-hidden>
            {row.lineNo ?? ''}
          </span>
        )}
        <span className={css.sign} aria-hidden>{sign}</span>
        <span className={css.content}>
          {paintContent(row.text, highlighted[absolute], row.strong, markClass)}
        </span>
      </div>
    )
  }

  return (
    <div className={clsx(css.block, className)} data-diff="">
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? copy.copied : copy.copy}
      </button>
      <div className={css.body}>
        {head.map((row, index) => renderRow(row, index, 0))}
        <ExpandCollapseToggle hidden={hidden} expanded={expanded} className={css.expand} labels={copy} onToggle={onToggle} />
        {tail.map((row, index) => renderRow(row, index, rows.length - tailLines))}
      </div>
      <div className={css.footer}>└ +{added} -{removed} · {files} file{files === 1 ? '' : 's'}</div>
    </div>
  )
}
