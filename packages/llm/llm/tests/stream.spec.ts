import { describe, expect, it } from 'vitest'
import { CallId, toolCallPhaseAfter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

const TOOL_DELTA: StreamChunk = {
  type: 'tool-call-delta',
  index: 0,
  id: CallId('call_1'),
  name: 'write',
  argumentsDelta: '{}',
}
const TEXT_DELTA: StreamChunk = { type: 'text-delta', index: 0, text: 'x' }
const REASONING_DELTA: StreamChunk = { type: 'reasoning-delta', index: 0, text: 'x' }
const BLOCK_START: StreamChunk = { type: 'block-start', index: 0, blockType: 'tool-call' }
const BLOCK_END: StreamChunk = { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } }
const USAGE: StreamChunk = { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
const FINISH: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

describe('toolCallPhaseAfter', () => {
  it('enters the tool-call phase on a tool-call delta', () => {
    expect(toolCallPhaseAfter(TOOL_DELTA, false)).toBe(true)
    expect(toolCallPhaseAfter(TOOL_DELTA, true)).toBe(true)
  })

  it('leaves the phase on text and reasoning deltas', () => {
    expect(toolCallPhaseAfter(TEXT_DELTA, true)).toBe(false)
    expect(toolCallPhaseAfter(REASONING_DELTA, true)).toBe(false)
    expect(toolCallPhaseAfter(TEXT_DELTA, false)).toBe(false)
  })

  it('keeps the phase through non-delta chunks', () => {
    for (const chunk of [BLOCK_START, BLOCK_END, USAGE, FINISH]) {
      expect(toolCallPhaseAfter(chunk, true)).toBe(true)
      expect(toolCallPhaseAfter(chunk, false)).toBe(false)
    }
  })
})
