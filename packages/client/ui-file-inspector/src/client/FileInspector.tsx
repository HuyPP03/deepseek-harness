// FileInspector: the conversation.details.file occupant. Two seats for one
// selected file — Changes (the latest diff card touching it in the window,
// drawn through the shared DiffBlock) and Code (the whole file's bytes over
// the raw channel, virtualized with line numbers and shared shiki
// highlighting). The tab state is component-local: the details panel keys
// the seat by the selected path, so a new file mounts a fresh component.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { DiffBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileBytesError } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { latestFileDiffs, langForPath } from './changes.ts'
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
export function FileInspector({ path, cwd, readFile, useSession, t }: FileInspectorProps) {
  // The nodes list is a structurally shared reference: it changes only when
  // the window actually moves, so the memo recomputes on real changes.
  const nodes = useSession((s: ConversationSnapshot) => s.nodes)
  const changes = useMemo(() => latestFileDiffs(nodes, path, cwd), [nodes, path, cwd])
  const [tab, setTab] = useState<'changes' | 'code'>(changes !== null ? 'changes' : 'code')
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

  const tabs: { id: 'changes' | 'code'; label: string }[] = [
    ...(changes !== null ? [{ id: 'changes' as const, label: t('tab.changes') }] : []),
    { id: 'code' as const, label: t('tab.code') },
  ]
  const active: 'changes' | 'code' = tab === 'changes' && changes !== null ? 'changes' : 'code'

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
        {active === 'changes' && changes !== null
          ? <DiffBlock diffs={changes} />
          : code.kind === 'loading'
            ? <div className={css.state}>{t('code.loading')}</div>
            : code.kind === 'error'
              ? <div className={css.state}>{code.status === 413 ? t('code.tooLarge') : t('code.unreadable')}</div>
              : code.binary
                ? <div className={css.state}>{t('code.binary')}</div>
                : code.text === ''
                  ? <div className={css.state}>{t('code.empty')}</div>
                  : <VirtualLines code={code.text} lang={langForPath(path)} />}
      </div>
    </div>
  )
}
