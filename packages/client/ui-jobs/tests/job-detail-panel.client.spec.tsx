// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { JobView, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { JobDetailPanel, type JobDetailPanelProps } from '../src/client/JobDetailPanel.tsx'
import { JobNotFoundError } from '../src/client/job-view.ts'
import { en } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId
const t: JobDetailPanelProps['t'] = makeTranslate(en)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function job(over: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm test',
    status: 'running',
    startedAt: 1_700_000_000_000,
    ...over,
  }
}

/**
 * The mirror is held in a mutable cell the test can swap between renders, so
 * a live→settled flip is a plain rerender — the same shape the real
 * session/jobs frames produce.
 */
function bench(jobId: string, jobs: readonly JobView[] | undefined, readJob: (jobId: string, signal: AbortSignal) => Promise<unknown>) {
  let mirror: readonly JobView[] | undefined = jobs
  function select<T>(pick: (snapshot: SessionListState) => T): T {
    // `undefined` stands in for a mirror that carries no row for the session.
    const row = mirror === undefined ? {} : { [SESSION]: mirror }
    return pick({ jobsBySession: row } as SessionListState)
  }
  const props = {
    jobId,
    sessionId: SESSION,
    useSessions: select,
    readJob: readJob as JobDetailPanelProps['readJob'],
    t,
  } as unknown as JobDetailPanelProps
  const view = render(<JobDetailPanel {...props} />)
  return {
    setMirror(next: readonly JobView[]) {
      mirror = next
      view.rerender(<JobDetailPanel {...props} />)
    },
    unmount: () => { view.unmount() },
  }
}

describe('JobDetailPanel log view', () => {
  it('renders the settled output once and polls no further', async () => {
    const readJob = vi.fn(async () => ({ text: 'done output', truncated: false }))
    bench('bash-1', [job({ status: 'completed', finishedAt: 1_700_000_001_000 })], readJob)
    await screen.findByText('done output')
    expect(readJob).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(1500 * 5)
    expect(readJob).toHaveBeenCalledTimes(1)
  })

  it('polls every 1500 ms while the job is live and stops after the settle flip', async () => {
    vi.useFakeTimers()
    const readJob = vi.fn(async () => ({ text: 'so far', truncated: false }))
    const b = bench('bash-1', [job()], readJob)
    await vi.advanceTimersByTimeAsync(0)
    expect(readJob).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1500 * 3)
    expect(readJob).toHaveBeenCalledTimes(4)

    // The mirror reports the settle: one final read, then silence.
    b.setMirror([job({ status: 'completed', finishedAt: 1_700_000_001_000 })])
    await vi.advanceTimersByTimeAsync(0)
    expect(readJob).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(1500 * 4)
    expect(readJob).toHaveBeenCalledTimes(5)
    b.unmount()
  })

  it('renders the empty placeholder until the first tail arrives', async () => {
    const readJob = vi.fn(async () => ({ text: '', truncated: false }))
    bench('bash-1', [job()], readJob)
    expect(screen.getByText(en['detail.empty'])).toBeTruthy()
  })

  it('flags the host tail cut under the log', async () => {
    const readJob = vi.fn(async () => ({ text: 'tail', truncated: true }))
    bench('bash-1', [job({ status: 'completed', finishedAt: 1_700_000_001_000 })], readJob)
    await screen.findByText('tail')
    expect(screen.getByText(en['detail.truncated'])).toBeTruthy()
  })

  it('renders the status line from the mirror, detail word first', async () => {
    const readJob = vi.fn(async () => ({ text: 'x', truncated: false }))
    bench('bash-1', [job({ status: 'killed', detail: 'signal: SIGTERM', finishedAt: 1_700_000_001_000 })], readJob)
    await screen.findByText('x')
    expect(screen.getByText('signal: SIGTERM')).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('renders the released state when the registry no longer holds the job', async () => {
    const readJob = vi.fn(async () => {
      throw new JobNotFoundError()
    })
    bench('bash-1', [job()], readJob)
    expect(await screen.findByText(en['detail.released'])).toBeTruthy()
  })

  it('renders the failure note for any other read error', async () => {
    const readJob = vi.fn(async () => {
      throw new Error('wire down')
    })
    bench('bash-1', [job()], readJob)
    expect(await screen.findByText(en['detail.failed'])).toBeTruthy()
  })

  it('aborts the in-flight read when the seat unmounts and swallows its rejection', async () => {
    let captured: AbortSignal | undefined
    const readJob = vi.fn((_jobId: string, signal: AbortSignal) => {
      captured = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) })
      })
    })
    const b = bench('bash-1', [job()], readJob)
    expect(captured).toBeDefined()
    expect(captured!.aborted).toBe(false)
    b.unmount()
    expect(captured!.aborted).toBe(true)
    // The rejection settles against the disposed guard; nothing may surface.
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByText('aborted')).toBeNull()
  })

  it('drops a result that settles after the seat unmounted', async () => {
    let release!: (value: { text: string; truncated: boolean }) => void
    const readJob = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const b = bench('bash-1', [job()], readJob)
    await screen.findByText(en['detail.empty'])
    b.unmount()
    release({ text: 'late', truncated: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByText('late')).toBeNull()
  })

  it('renders no status line while the mirror no longer knows the job', async () => {
    const readJob = vi.fn(async () => ({ text: 'settled tail', truncated: false }))
    const b = bench('bash-1', undefined, readJob)
    await screen.findByText('settled tail')
    expect(screen.queryByText('pnpm test')).toBeNull()
    b.unmount()
  })

  it('discards an aborted superseded read and commits the latest one', async () => {
    let first: AbortSignal | undefined
    let release!: (value: { text: string; truncated: boolean }) => void
    const readJob = vi.fn((_jobId: string, signal: AbortSignal) => {
      if (first === undefined) {
        first = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('superseded')) })
        })
      }
      return new Promise((resolve) => { release = resolve })
    })
    bench('bash-1', [job()], readJob)
    expect(await screen.findByText(en['detail.empty'])).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 1600)) // the next poll supersedes read 1
    expect(first!.aborted).toBe(true)
    expect(readJob).toHaveBeenCalledTimes(2)
    release({ text: 'latest', truncated: false })
    expect(await screen.findByText('latest')).toBeTruthy()
  })
})
