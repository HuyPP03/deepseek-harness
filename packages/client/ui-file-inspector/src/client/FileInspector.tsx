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
import { DiffBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileBytesError } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { latestFileDiffs, langForPath, previewKindForPath, type PreviewKind } from './changes.ts'
import { VirtualLines } from './VirtualLines.tsx'
import css from './FileInspector.module.css'

export type { FileInspectorProps } from './contract/slots.ts'
import type { FileInspectorProps } from './contract/slots.ts'

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
    tabs.some(entry => entry.id === tab) ? tab : tabs[0]?.id ?? 'code'

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
          ? <PreviewSeat kind={previewKind} path={path} fileUrl={fileUrl} code={code} t={t} />
          : active === 'changes' && changes !== null
            ? <DiffBlock diffs={changes} />
            : codeSeat}
      </div>
    </div>
  )
}

/**
 * The preview seat: the read text through the shared Markdown renderer, or
 * the raw channel's own URL on an image / SVG / sandboxed frame (the browser
 * decodes the bytes without a JS copy).
 * @param props - the preview kind, the file's path, the raw URL callback, the
 *   shared code state (Markdown reuses the text read), and the locale.
 * @returns the preview surface.
 */
function PreviewSeat({ kind, path, fileUrl, code, t }: {
  kind: PreviewKind
  path: string
  fileUrl: (path: string) => string
  code: CodeState
  t: FileInspectorProps['t']
}) {
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
