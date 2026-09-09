// JobDetailPanel: the details seat for a selected background job. The status
// line and label come from the session/jobs mirror the header list reads, and
// the log bytes come from the injected `jobs.log` unary: fetched immediately
// on mount and every 1500 ms while the job is live in the mirror, plus one
// final fetch once the mirror reports the job settled (or the row vanished).
// The host tail-bounds every read, so the panel shows the most recent part of
// a long log and flags the cut.

import { useEffect, useState } from 'react'
import type { JobView } from '@deepseek-ai/dsh-client-runtime/client'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { dotState, isLive, JobNotFoundError, statusLabel } from './job-view.ts'
import { NS } from './locales.ts'
import css from './JobDetailPanel.module.css'

/** The job's retained log tail, as the host bounded it. */
export interface JobLogRead {
  /** The retained tail of the job's output (empty for a live final-output job). */
  text: string
  /** The host cut earlier bytes off the wire value. */
  truncated: boolean
}

/** Injected share of the job log seat: the host-side `jobs.log` unary. */
export interface JobDetailPanelInjected {
  /**
   * Read the job's retained log without consuming the model's read.
   * @param jobId - the registry-issued job id.
   * @param signal - aborts the in-flight read.
   * @returns the retained tail and whether the host cut earlier bytes.
   * @throws {JobNotFoundError} the registry no longer holds the job.
   */
  readJob: (jobId: string, signal: AbortSignal) => Promise<JobLogRead>
}

/** Full props composed by reference from the contract. */
export type JobDetailPanelProps =
  PropsRuntime<'conversation.details.job'> & JobDetailPanelInjected & PropsLocale<typeof NS>

/** How often a live job's log is refetched. */
const POLL_INTERVAL_MS = 1_500

/** Stable empty mirror row so a session with no jobs keeps one array identity. */
const NO_JOBS: readonly JobView[] = []

interface LogState {
  text: string
  truncated: boolean
  /** The registry no longer holds the job (released or unknown id). */
  gone: boolean
  /** The read failed for a reason other than the job being gone. */
  failed: boolean
}

const EMPTY_LOG: LogState = { text: '', truncated: false, gone: false, failed: false }

/**
 * @param props - the owner share (jobId), the session share, the injected
 * log read, and the namespace translator.
 * @returns the status line (while the mirror knows the job) and the log view.
 */
export function JobDetailPanel({ jobId, useSessions, sessionId, readJob, t }: JobDetailPanelProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_JOBS
  const job = jobs.find(candidate => candidate.id === jobId)
  const live = job !== undefined && isLive(job)
  const [log, setLog] = useState<LogState>(EMPTY_LOG)

  // `live` re-arms the effect: while true the interval polls, and the single
  // immediate fetch on the false (re)run is the terminal job's final read.
  useEffect(() => {
    let disposed = false
    let controller: AbortController | undefined
    const read = (): void => {
      // A superseding read aborts the one it replaces: only the latest
      // tail may commit, so an old response can never regress the view.
      controller?.abort()
      const current = new AbortController()
      controller = current
      void readJob(jobId, current.signal).then(
        (value) => {
          if (disposed) return
          setLog({ text: value.text, truncated: value.truncated, gone: false, failed: false })
        },
        (error: unknown) => {
          // A torn-down seat aborts its own read; everything else is a host
          // failure worth showing.
          if (disposed || current.signal.aborted) return
          setLog(prev => error instanceof JobNotFoundError
            ? { ...prev, gone: true, failed: false }
            : { ...prev, failed: true })
        },
      )
    }
    read()
    if (!live) return undefined
    const timer = setInterval(read, POLL_INTERVAL_MS)
    return () => {
      disposed = true
      controller?.abort()
      clearInterval(timer)
    }
  }, [jobId, readJob, live])

  return (
    <div className={css.root}>
      {job !== undefined && (
        <div className={css.statusLine}>
          <StateDot state={dotState(job.status)} className={css.dot} />
          <span className={css.kind}>{job.kind}</span>
          <span className={css.label} title={job.label}>{job.label}</span>
          <span className={css.status}>{job.detail ?? statusLabel(job.status, t)}</span>
        </div>
      )}
      {log.gone
        ? <div className={css.note}>{t('detail.released')}</div>
        : log.failed
          ? <div className={css.note}>{t('detail.failed')}</div>
          : (
            <>
              <pre className={css.log}>
                {log.text === ''
                  ? <span className={css.logEmpty}>{t('detail.empty')}</span>
                  : log.text}
              </pre>
              {log.truncated && <div className={css.note}>{t('detail.truncated')}</div>}
            </>
          )}
    </div>
  )
}
