// FileInspector: the conversation.details.file occupant. Up to three seats
// for one selected file — Preview (Markdown rendered, or the raw channel's
// own URL on an image/SVG/HTML element), Changes (the latest diff card
// touching it in the window, drawn through the shared DiffBlock), and Code
// (the whole file's bytes over the raw channel, virtualized with line
// numbers and shared shiki highlighting). The tab state is component-local:
// the details panel keys the seat by the selected path, so a new file mounts
// a fresh component.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { DiffBlock, MarkdownText, type DiffBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { FileBytesError } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { latestFileDiffs, langForPath, previewKindForPath, type PreviewKind } from './changes.ts'
import { docxToHtml, sheetToGrid, type SheetRow } from './preview.ts'
import { VirtualLines } from './VirtualLines.tsx'
import css from './FileInspector.module.css'

export type { FileInspectorProps } from './contract/slots.ts'
import type { FileInspectorProps } from './contract/slots.ts'

/**
 * The diff surface's display copy, resolved from the shared block vocabulary
 * (common namespace) through this seat. The conversation tool rows resolve
 * the same keys through their own seat; the common namespace is the one
 * address both features share (a cross-plugin import of the other's adapter
 * is not a sanctioned route).
 * @param t - this seat's translate (the keys resolve through common).
 * @returns the full label set for {@link DiffBlock}'s `labels`.
 */
function diffBlockLabels(t: Translate<CommonKeyOf>): DiffBlockLabels {
  return {
    copy: t('copy'),
    copied: t('copied'),
    collapseAria: t('diff.collapseAria'),
    expandAria: hidden => t('diff.expandAria', { n: hidden }),
    collapse: t('collapse'),
    expand: hidden => t('diff.expandRest', { n: hidden }),
  }
}

/** The code seat's settled states. */
type CodeState =
  | { kind: 'loading' }
  | { kind: 'ok'; text: string; binary: boolean }
  | { kind: 'error'; status: number }

/** A NUL byte in the leading window marks the file binary (the text read's rule). */
const BINARY_SNIFF_BYTES = 8 * 1024

/**
 * The inspector body for one selected file.
 * @param props - the owner share (path, cwd), the session share, the injected
 *   byte read, and the locale.
 * @returns the tab strip plus the active seat.
 */
export function FileInspector({ path, cwd, readFile, fileUrl, useSession, t }: FileInspectorProps) {
  // The nodes list is a structurally shared reference: it changes only when
  // the window actually moves, so the memo recomputes on real changes.
  const nodes = useSession((s: ConversationSnapshot) => s.nodes)
  const changes = useMemo(() => latestFileDiffs(nodes, path, cwd), [nodes, path, cwd])
  const previewKind = useMemo(() => previewKindForPath(path), [path])
  const [tab, setTab] = useState<'preview' | 'changes' | 'code'>(
    previewKind !== null ? 'preview' : changes !== null ? 'changes' : 'code')
  const [code, setCode] = useState<CodeState>({ kind: 'loading' })

  const loadCode = useCallback(() => {
    const controller = new AbortController()
    setCode({ kind: 'loading' })
    void readFile(path, controller.signal).then(
      (view) => {
        const head = view.bytes.subarray(0, BINARY_SNIFF_BYTES)
        let binary = false
        for (let i = 0; i < head.length; i += 1) {
          if (head[i] === 0) { binary = true; break }
        }
        setCode({ kind: 'ok', text: binary ? '' : new TextDecoder().decode(view.bytes), binary })
      },
      (error: unknown) => {
        // Any refusal (raw channel or otherwise) lands on the unreadable
        // state; only 413 earns its own copy.
        setCode({ kind: 'error', status: error instanceof FileBytesError ? error.status : 0 })
      },
    )
    return () => { controller.abort() }
  }, [path, readFile])

  useEffect(() => loadCode(), [loadCode])

  // A pure image earns no Code tab: its bytes are not a text view.
  const tabs: { id: 'preview' | 'changes' | 'code'; label: string }[] = [
    ...(previewKind !== null ? [{ id: 'preview' as const, label: t('tab.preview') }] : []),
    ...(changes !== null ? [{ id: 'changes' as const, label: t('tab.changes') }] : []),
    ...(previewKind !== 'image' ? [{ id: 'code' as const, label: t('tab.code') }] : []),
  ]
  const active: 'preview' | 'changes' | 'code' =
    // The tab is only ever set from this array (initial pick or a tab click)
    // and the seat remounts per selection, so the fallback is unreachable.
    tabs.some(entry => entry.id === tab)
      ? tab
      : /* v8 ignore next -- tab can only hold an id from this array */ tabs[0]?.id ?? 'code'

  // The Code seat's four states: streaming, a raw-channel refusal, a binary
  // sniff, and an empty file.
  const codeSeat = code.kind === 'loading'
    ? <div className={css.state}>{t('code.loading')}</div>
    : code.kind === 'error'
      ? <div className={css.state}>{code.status === 413 ? t('code.tooLarge') : t('code.unreadable')}</div>
      : code.binary
        ? <div className={css.state}>{t('code.binary')}</div>
        : code.text === ''
          ? <div className={css.state}>{t('code.empty')}</div>
          : <VirtualLines code={code.text} lang={langForPath(path)} />

  return (
    <div className={css.root}>
      {tabs.length > 1 && (
        <div className={css.tabs} role="tablist">
          {tabs.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active === entry.id}
              className={clsx(css.tab, active === entry.id && css.tabActive)}
              onClick={() => { setTab(entry.id) }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      <div className={css.seat}>
        {active === 'preview' && previewKind !== null
          ? <PreviewSeat kind={previewKind} path={path} fileUrl={fileUrl} readFile={readFile} code={code} t={t} />
          : active === 'changes' && changes !== null
            ? <DiffBlock diffs={changes} labels={diffBlockLabels(t)} />
            : codeSeat}
      </div>
    </div>
  )
}

/**
 * The preview seat: the read text through the shared Markdown renderer, the
 * raw channel's own URL on an image / SVG / sandboxed frame (the browser
 * decodes the bytes without a JS copy), or the office parsers (docx, xlsx,
 * csv) over the read bytes.
 * @param props - the preview kind, the file's path, the raw URL callback, the
 *   byte read (office seats parse the bytes), the shared code state (Markdown
 *   reuses the text read), and the locale.
 * @returns the preview surface.
 */
function PreviewSeat({ kind, path, fileUrl, readFile, code, t }: {
  kind: PreviewKind
  path: string
  fileUrl: (path: string) => string
  readFile: FileInspectorProps['readFile']
  code: CodeState
  t: FileInspectorProps['t']
}) {
  if (kind === 'docx' || kind === 'xlsx' || kind === 'csv') {
    return <OfficeSeat kind={kind} path={path} readFile={readFile} t={t} />
  }
  if (kind === 'markdown') {
    if (code.kind !== 'ok' || code.binary) {
      return <div className={css.state}>{
        code.kind === 'loading'
          ? t('code.loading')
          : code.kind === 'error'
            ? (code.status === 413 ? t('code.tooLarge') : t('code.unreadable'))
            : t('code.binary')
      }</div>
    }
    if (code.text === '') return <div className={css.state}>{t('code.empty')}</div>
    return <div className={css.previewScroll}><MarkdownText text={code.text} /></div>
  }
  if (kind === 'html') {
    return <iframe
      src={fileUrl(path)}
      title={path}
      // No allow-list at all: a file preview must not run its own scripts.
      sandbox=""
      className={css.frame}
    />
  }
  return <img src={fileUrl(path)} alt={path} className={css.img} />
}

/** The office seats' settled states: parsing, a parse/read failure, and the two parses. */
type OfficeState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'docx'; html: string }
  | { kind: 'grid'; rows: SheetRow[] }

/**
 * The docx / xlsx / csv seat: the read bytes through the lazy-loaded parser
 * (mammoth or SheetJS); the byte read is cached, so this is not a second
 * download. Docx lands in a sandboxed frame (srcDoc), sheets in a table.
 * @param props - the kind, the file's path, the byte read, and the locale.
 * @returns the loading / failed / parsed surface.
 */
function OfficeSeat({ kind, path, readFile, t }: {
  kind: 'docx' | 'xlsx' | 'csv'
  path: string
  readFile: FileInspectorProps['readFile']
  t: FileInspectorProps['t']
}) {
  const [state, setState] = useState<OfficeState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void readFile(path, controller.signal).then(
      (view) => {
        const parse = kind === 'docx'
          ? docxToHtml(view.bytes).then(html => ({ kind: 'docx' as const, html }))
          : sheetToGrid(view.bytes).then(rows => ({ kind: 'grid' as const, rows }))
        void parse.then((next) => { if (!controller.signal.aborted) setState(next) })
      },
      () => { if (!controller.signal.aborted) setState({ kind: 'failed' }) },
    )
    return () => { controller.abort() }
  }, [kind, path, readFile])

  if (state.kind === 'loading') return <div className={css.state}>{t('code.loading')}</div>
  if (state.kind === 'failed') return <div className={css.state}>{t('preview.failed')}</div>
  if (state.kind === 'docx') {
    return <iframe
      srcDoc={state.html}
      title={path}
      // No allow-list at all: a file preview must not run its own scripts.
      sandbox=""
      className={css.frame}
    />
  }
  return (
    <div className={css.gridScroll}>
      <table className={css.gridTable}>
        <tbody>
          {state.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => <td key={c}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
