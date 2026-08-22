// FileBrowser: the conversation.details.files occupant. The session's
// working-set file list (the bounded walk the composer's `@` source shares)
// as the details panel's browse seat — the inspector's entry point for a file
// no mutation tool announced, such as one a shell command created. One fetch
// per seat mount (the seat is keyed by the browsed directory, so reopening
// the panel re-fetches); the filter input narrows the returned window
// locally, since a chat session's working set is far smaller than the walk's
// 100-row bound.

import { useEffect, useMemo, useState } from 'react'
import type { FileEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { clsx } from 'clsx'
import type { FileBrowserProps } from './contract/slots.ts'
import css from './FileInspector.module.css'

export type { FileBrowserProps } from './contract/slots.ts'

/** The list seat's settled states. */
type ListState =
  | { kind: 'loading' }
  | { kind: 'ok'; rows: readonly FileEntry[]; truncated: boolean }
  | { kind: 'error' }

/**
 * The one-line display form of a walk row: workspace-relative for the main
 * project, basename-rooted for an attached reference project.
 * @param row - one files.list row.
 * @returns the relative display path (no trailing slash).
 */
function displayOf(row: FileEntry): string {
  return row.root === 'workspace' ? row.relative : `${row.root}/${row.relative}`
}

/**
 * The session file list seat.
 * @param props - the owner share (dir, cwd), the injected listing and opener,
 *   and the locale.
 * @returns the filter input plus the row list (or the loading/empty/error
 *   state).
 */
export function FileBrowser({ listFiles, openFile, t }: FileBrowserProps) {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    listFiles(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setState({ kind: 'ok', rows: result.rows, truncated: result.truncated })
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error' })
      },
    )
    return () => { controller.abort() }
  }, [listFiles])

  const visible = useMemo(() => {
    if (state.kind !== 'ok') return []
    const q = query.trim().toLowerCase().replace(/\\/gu, '/')
    if (q === '') return state.rows
    return state.rows.filter(row => displayOf(row).toLowerCase().replace(/\\/gu, '/').includes(q))
  }, [state, query])

  if (state.kind === 'loading') return <div className={css.state}>{t('browser.loading')}</div>
  if (state.kind === 'error') return <div className={css.state}>{t('browser.failed')}</div>

  return (
    <div className={css.browserRoot}>
      <input
        type="text"
        className={css.browserFilter}
        placeholder={t('browser.filterPlaceholder')}
        value={query}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {state.truncated && <div className={css.browserNote}>{t('browser.truncated')}</div>}
      {visible.length === 0
        ? <div className={css.state}>{t('browser.empty')}</div>
        : (
          <ul className={css.browserList}>
            {visible.map((row) => {
              const display = displayOf(row)
              return row.isDirectory
                ? (
                  // Directories are context, not targets: the relative path
                  // below already locates every file, and the inspector has
                  // no directory view to hand a folder pick to.
                  <li key={`${row.root}:${row.relative}`} className={css.browserRowDir}>
                    <span className={css.browserName}>{display}/</span>
                  </li>
                )
                : (
                  <li key={`${row.root}:${row.relative}`}>
                    <button
                      type="button"
                      className={clsx(css.browserRow)}
                      title={row.path}
                      onClick={() => { openFile(row.path) }}
                    >
                      <span className={css.browserName}>{display}</span>
                    </button>
                  </li>
                )
            })}
          </ul>
        )}
    </div>
  )
}
