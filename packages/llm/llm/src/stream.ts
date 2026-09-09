/**
 * Stream-phase tracking shared by the idle-window adapters. Some providers
 * batch tool-call arguments (a vLLM tool parser holds an entire argument value
 * and flushes it while generation continues), so a long file write produces a
 * long wire gap that must not read as provider idle time.
 *
 * @module @open-harness/oh-llm/stream
 */

import type { StreamChunk } from './types.ts'

/**
 * Tool-call phase of a stream after one observed chunk. A `tool-call-delta`
 * enters (or keeps) the tool-call phase; a `text-delta` or `reasoning-delta`
 * leaves it; every other chunk kind leaves the phase unchanged.
 * @param chunk - the chunk the adapter just yielded.
 * @param inToolCall - whether the stream was in the tool-call phase before this chunk.
 * @returns the phase to hold until the next chunk.
 */
export function toolCallPhaseAfter(chunk: StreamChunk, inToolCall: boolean): boolean {
  switch (chunk.type) {
    case 'tool-call-delta':
      return true
    case 'text-delta':
    case 'reasoning-delta':
      return false
    case 'block-start':
    case 'block-end':
    case 'usage':
    case 'finish':
      return inToolCall
  }
}
