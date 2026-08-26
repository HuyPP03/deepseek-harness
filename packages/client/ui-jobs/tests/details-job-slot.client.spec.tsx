// @vitest-environment jsdom
// The job log seat's acceptance chain on the REAL machinery stack:
// SlotTestRuntime (cordis Context + SlotRegistry ledger + the web-react
// renderer) + the ui-conversation and ui-jobs applies — no outlet twins.
// Proves the conversation.details.job seat end to end: the occupant lands
// through slots.inject once the details entry declares it, a job selection
// routed by the details panel reads the log through the connection's
// jobs.log face, and a header row click opens the panel through the
// detailsPanel service.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import type { ISession, JobView, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyJobs, inject as injectJobs } from '../src/client/index.ts'

const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the virtual view and the composer seat publish through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  // The chat store persists under its declared key; a previous bench's
  // selection would rehydrate into this one.
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

/** Test-owned AppFrame role: declares and renders the resident conversation and details areas. */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}{renderSlot('details', {})}</>
}

const LAYOUT_CHILDREN = {
  'conversation': { kind: 'single', scope: 'session-maybe' },
  'details': { kind: 'single', scope: 'session' },
} as const

const jobView: JobView = {
  id: 'bash-1' as JobView['id'],
  kind: 'bash',
  label: 'pnpm test',
  status: 'completed',
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_000,
}

/**
 * Real-stack bench: SlotTestRuntime with the session double at the service
 * boundary only, both package applies on their own fibers, and the connection
 * face faked at the jobs.log boundary. `jobsLog` stands in for the RPC the
 * seat polls.
 */
async function bench(
  jobsLog: (request: { sessionId: SessionId; jobId: string }) => Promise<unknown>,
) {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', {
    api: { settings: {}, jobs: { log: jobsLog } },
    isLoopback: false,
  })
  // ui-theme's Appearance row binds a durable scope through these two.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layout)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S', cwd: '/tmp/proj' },
    snapshot: {
      nodes: [],
      chat: {
        order: [] as string[],
        nodes: { get: () => undefined, values: () => [] },
        locations: { getTurn: () => [] as string[], getStep: () => [] as string[] },
        timeline: { turnOrder: [], turns: new Map() },
        legacy: { nodes: [], runningCalls: [], partial: null, turnTimings: new Map(), turnEnds: new Map() },
      },
    },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  // The session/jobs mirror the seat's status line and the header row read.
  runtime.sessions.list.update((draft) => {
    // The wire type is readonly; the draft's mirror row is the test's own cell.
    ;(draft.jobsBySession as Record<SessionId, readonly JobView[]>)[SID] = [jobView]
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectJobs], apply: applyJobs })
  return { runtime, layout }
}

describe('conversation.details.job seat through the real machinery', () => {
  it('routes a job selection to the seat and reads the log through the connection face', async () => {
    const log = vi.fn(async () => ({
      result: { ok: true, value: { text: 'hello from the job\n', truncated: false } },
    }))
    const b = await bench(log)
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 0, jobId: 'bash-1' })
    await b.runtime.flush()
    expect(await view.findByText('hello from the job')).toBeTruthy()
    // The status line renders from the session/jobs mirror.
    expect(view.getByText('pnpm test')).toBeTruthy()
    expect(log).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('shows the unavailable fallback when the host reports the job gone', async () => {
    const log = vi.fn(async () => ({
      result: {
        ok: false,
        error: { code: 'job-not-found', message: 'unknown job bash-9', details: { sessionId: SID, jobId: 'bash-9' } },
      },
    }))
    const b = await bench(log)
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 0, jobId: 'bash-9' })
    await b.runtime.flush()
    expect(await view.findByText('This job is no longer available')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('renders the failure note when the read fails for any other reason', async () => {
    const log = vi.fn(async () => ({
      result: {
        ok: false,
        error: { code: 'job-unauthorized', message: 'foreign job', details: { jobId: 'bash-1' } },
      },
    }))
    const b = await bench(log)
    const view = b.runtime.renderRoot()
    const details = b.runtime.storeOf('details', SID) as unknown as { actions: { select: (target: unknown) => void } }
    details.actions.select({ turnSeq: 0, jobId: 'bash-1' })
    await b.runtime.flush()
    expect(await view.findByText('The job log could not be read')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('opens the seat from a header row click through the detailsPanel service', async () => {
    const log = vi.fn(async () => ({
      result: { ok: true, value: { text: 'row log', truncated: false } },
    }))
    const b = await bench(log)
    const view = b.runtime.renderRoot()
    // The header trigger carries the settled-job count; open it and click the row.
    fireEvent.click(view.getByRole('button', { name: /background job/i }))
    await b.runtime.flush()
    fireEvent.click(view.getByRole('listitem').querySelector('button')!)
    await b.runtime.flush()
    expect(b.layout.openDetails).toHaveBeenCalledTimes(1)
    expect(await view.findByText('row log')).toBeTruthy()
    expect(log).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })
})
