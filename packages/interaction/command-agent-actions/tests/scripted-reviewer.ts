import { vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  type SubagentProvider,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'

/** One scripted reviewer child: reply text, optional stop reason, settle delay. */
interface ScriptedChild {
  reply?: string
  stopReason?: SubagentStopReason
  settleMs?: number
  /** Synchronous start() failure for this facet. */
  startError?: Error
}

/** A minimal SubagentProvider that publishes scripted one-shot runs. */
export class ScriptedReviewer implements SubagentProvider {
  readonly name: string
  readonly capabilities = { outputSchema: false, depthLimit: false, toolFilter: false, persona: false }
  readonly inheritsParentContext = false
  readonly requests: SubagentStartRequest[] = []
  readonly runs: SubagentRun[] = []
  readonly disposeSpies: Array<ReturnType<typeof vi.fn>> = []
  queue: ScriptedChild[]
  private index = 0

  constructor(name: string, children: ScriptedChild[]) {
    this.name = name
    this.queue = children
  }

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    if (request.signal.aborted) throw new Error('scripted reviewer start aborted before publication')
    const spec = this.queue[this.index++] ?? { reply: `finding ${this.index}` }
    if (spec.startError !== undefined) throw spec.startError
    this.requests.push(request)
    const reply = spec.reply ?? ''
    const dispose = vi.fn(async () => {})
    const result = new Promise<SubagentResult>((resolve) => {
      setTimeout(() => {
        const stopReason: SubagentStopReason = request.signal.aborted ? 'aborted' : spec.stopReason ?? 'completed'
        resolve({ output: [{ type: 'text', text: reply }], stopReason })
      }, spec.settleMs ?? 0)
    })
    this.runs.push({
      id: SessionId(`scripted-${this.name}-${this.requests.length}`),
      localAgent: undefined,
      result,
      dispose,
    })
    this.disposeSpies.push(dispose)
    return this.runs[this.runs.length - 1]!
  }
}
