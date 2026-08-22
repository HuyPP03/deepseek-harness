// VirtualLines: the Code tab's line-numbered, syntax-highlighted view over a
// whole file. Only the visible row window (plus overscan) is mounted — the
// file's byte length is a layout height, never a DOM size. Highlighting runs
// through the shared shiki path (per-line token runs); a language without a
// loaded grammar falls back to plain text and re-renders when the lazy
// grammar lands.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { clsx } from 'clsx'
import { grammarLoadCount, highlightLines, subscribeGrammarLoaded, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './FileInspector.module.css'

/** One layout row (must match `--insp-line-height` in the module sheet). */
const LINE = 20
/** Rows drawn beyond the viewport on each side. */
const OVERSCAN = 8

interface VirtualLinesProps {
  /** The whole file text (already decoded; the raw channel's bound applies). */
  code: string
  /** Grammar hint; undefined renders plain text. */
  lang?: string | undefined
}

/** One visible row: gutter number + token runs (or plain text). */
function LineRow({ number, text, spans }: { number: number; text: string; spans: HighlightSpan[] | null }) {
  return (
    <div className={css.line}>
      <span className={css.gutter} aria-hidden>{number}</span>
      <span className={css.code}>
        {spans === null ? text : spans.map((s, i) => (
          <span key={i} style={s.style}>{s.text}</span>
        ))}
      </span>
    </div>
  )
}

/**
 * A virtualized line list: the full height is a spacer, the visible slice is
 * translated into view, and scroll/resize recompute the slice.
 * @param props - the code and its grammar hint.
 * @returns the scrollable view.
 */
export function VirtualLines({ code, lang }: VirtualLinesProps) {
  // An empty text never reaches the virtual view (the code seat renders its
  // own empty state first); the empty-code arms below are defensive.
  /* v8 ignore next -- empty code is filtered by the code seat's empty state */
  const lines = useMemo(() => (code === '' ? [] : code.split('\n')), [code])
  // Re-render when a lazy grammar finishes loading so a plain fallback picks
  // up highlighting (the snapshot value is opaque; only its change matters).
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  /* v8 ignore next -- lines can only be empty for the filtered empty code */
  const spans = useMemo(
    () => (lines.length === 0 ? [] : (highlightLines(code, lang) ?? null)),
    [code, lines.length, lang, loaded],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(400)

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    // The ref is set before the effect runs (mounted view); null is only the
    // disposal-order defensive case.
    /* v8 ignore next -- ref is set by React before the mount effect */
    if (el === null) return
    const measure = () => { setViewH(el.clientHeight) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

  const start = Math.max(0, Math.floor(scrollTop / LINE) - OVERSCAN)
  const end = Math.min(lines.length, Math.ceil((scrollTop + viewH) / LINE) + OVERSCAN)
  const visible = lines.slice(start, end)

  return (
    <div className={clsx(css.scroll, 'shiki')} ref={scrollRef} onScroll={onScroll} data-line-height={LINE}>
      <div className={css.spacer} style={{ height: lines.length * LINE }}>
        <div className={css.window} style={{ transform: `translateY(${start * LINE}px)` }}>
          {visible.map((line, i) => {
            const number = start + i + 1
            const row = spans === null ? null : (spans[start + i] ?? null)
            return <LineRow key={number} number={number} text={line} spans={row} />
          })}
        </div>
      </div>
    </div>
  )
}
