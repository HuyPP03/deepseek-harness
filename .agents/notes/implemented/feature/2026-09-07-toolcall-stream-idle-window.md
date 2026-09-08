# Agent Note: per-phase stream idle window for tool calls

Status: implemented

English | [中文](2026-09-07-toolcall-stream-idle-window.zh.md)

## Problem

The LLM adapters bound each outstanding provider read with a five-minute stream-idle watchdog. The watchdog rearms on every `StreamChunk`, so it tracks every token a server sends — but it cannot track tokens a server does not send. Measured against a real deployment (vLLM serving a Qwen model), the OpenAI-compatible endpoint batches tool-call arguments: the `write` tool's `content` value is held server-side while generation continues and flushed in one late SSE event, with the wire fully silent in between. A file whose generation exceeds the five-minute base window therefore reads as provider silence, trips the watchdog, and the normal retry policy re-runs the generation from scratch up to twice before the turn ends in `TIMEOUT`.

The client has no way to observe the server's in-flight tokens during that gap, so the fix cannot be "detect that the model is still working". It is to make the window match the phase: text and reasoning keep the short window that catches real hangs, and the tool-call phase — where argument batching is legitimate — gets its own, deployment-configured window.

## Decision

The idle window is per-phase, switched in each adapter's stream loop:

- `dsh-timeout`'s `IdleWatchdog` gains `setIdleTimeout(ms)`. The new interval applies to every arm after the call; an already outstanding demand keeps its original deadline, and the `TimeoutReason` reports the interval in force when its timer fires.
- `dsh-llm` exports `toolCallPhaseAfter(chunk, inToolCall)`: a `tool-call-delta` enters (or keeps) the tool-call phase, a `text-delta` or `reasoning-delta` leaves it, and every other chunk kind (`block-start`, `block-end`, `usage`, `finish`) leaves the phase unchanged.
- Both adapters (`dsh-llm-deepseek`, `dsh-llm-pi-ai`) run the same state machine over their yielded chunks and call `watchdog.setIdleTimeout` on each phase transition. The timeout error message reports the window that actually fired.
- Each provider configuration gains `toolCallStreamIdleTimeoutMs` (positive finite Node timer delay), defaulting to that provider's `streamIdleTimeoutMs`, so deployments that do not configure it keep today's behavior exactly.

The phase is keyed on delta chunks, not on `block-start`/`block-end`: both adapters defer `block-end` to stream close, so a block-boundary state machine would widen the window for the rest of the stream once any tool call opened. Keying on the last observed delta kind restores the base window as soon as the model returns to text or reasoning.

## Alternatives considered

**Fix the server instead.** A vLLM deployment that streams tool-call arguments incrementally (or sends SSE keep-alives during generation) makes the base window correct again, and this is the root-cause fix for that deployment. It does not help the other deployments whose servers batch, and the harness cannot detect which kind it is talking to, so the wider phase window stays as the deployment-tunable answer.

**Widen the window for the whole stream once a tool call appears.** Simpler (no state machine), but a hang in the text phase after a tool call would then wait the wide window instead of the base one. The delta-keyed machine adds four lines per adapter and keeps the base window honest outside the tool phase.

**A per-tool-name list (only `write` widens).** The batching behavior belongs to the server's tool-argument handling, not to a tool name: `edit`, `bash` heredocs, and any tool with a large argument hit the same gap. A name list would be a hardcoded tunable with false negatives.

**Retry-awareness instead (do not retry a `TIMEOUT` that already produced output).** Orthogonal hardening: a retry re-runs the generation from scratch either way, and a deployment can already express "do not retry timeouts" through its provider `retryPolicy.retryableCodes`. Not part of this change.

## Testing

- `dsh-timeout`: `setIdleTimeout` interval switching between arms, the outstanding-demand deadline rule, the fired-reason interval, and bound validation.
- Both adapter suites: a wire gap inside a tool call survives under the tool window; the same gap times out under the default (base) window and under a tool window shorter than the gap, reporting the tool window in the message; a text gap times out on the base window even with a tool window configured; and a text gap after a tool call times out on the restored base window.
- Both plugin suites: `toolCallStreamIdleTimeoutMs` defaulting to the base window, and rejection of non-positive, non-finite, and over-cap values at the resolver and plugin-load boundaries.

## Consequences

- A deployment whose server batches tool arguments can now carry long file writes: `~/.dsh/settings.yaml` (or the entry config) sets `toolCallStreamIdleTimeoutMs` on the affected provider. Untouched deployments keep the five-minute behavior for every phase.
- A hung server mid-tool-call now waits the configured tool window (wide) before `TIMEOUT` instead of five minutes; deployments that want a shorter bound configure a smaller `toolCallStreamIdleTimeoutMs`.
- The watchdog's timeout message and `TimeoutReason.timeoutMs` can differ from the provider's base window during the tool phase; consumers that parse the message text see the window that fired, which is the honest fact.

## Related

- [bounded LLM request recovery](../architecture/2026-06-21-bounded-llm-request-recovery.md) owns the base `streamIdleTimeoutMs` watchdog semantics this note extends.
- [provider-routed LLM adapters](../architecture/2026-07-14-provider-routed-llm-adapters.md) owns the per-profile scoping under which both idle windows resolve.
