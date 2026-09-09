# Agent Note: Background-job log details panel

Status: implemented

English | [中文](2026-08-25-background-job-log-details-panel.zh.md)

## Problem

The [Web background-job list](2026-08-08-web-background-job-display.md) gives a human the registry's state — which jobs exist, their status, their duration — but the output of a running job is still model-only. A clicked row had nowhere to land: the registry's single read, `read()`, consumes the job's one read cursor and marks the job reported on a terminal read, so a browser that polled it would have silently stolen the bytes the model's `job_output` was owed and suppressed the completion notice. The list's deferred phase — per-task streamed output — was blocked on a seam fact: `JobRegistry` had no non-consuming read.

## Decision

The human read becomes its own seam method, and the panel the list's rows open is the browser's occupant of a new details seat.

### The seam: `JobRegistry.log`

```ts ignore-check
abstract log(id: JobId, caller?: Agent): JobLogRead
```

`log` returns the job's retained output for human surfaces without touching model-facing state: the cursor `read` consumes does not advance and the job is not marked reported, so the model's next read stays complete. The owner fence is the same session-id comparison as every other method.

`LocalJobRegistry` tees every drained producer delta into a per-job `logText` — the wrapped `readOutput` stays the single consumption point, and `read`'s delta becomes the slice of `logText` after the model cursor. Retention is one configuration field, `jobLogRetainChars`, a positive safe integer defaulting to `2_097_152` (2 MiB in UTF-16 code units; `String.length` keeps the tail bound O(1)). Beyond the cap the head drops, and the model cursor rides the same window: a drop wholly behind the cursor only shifts it, while a drop that swallowed bytes the model had not yet consumed resets the cursor to the retained head and the model's next `read()` carries a one-shot `[job log head dropped]\n` marker. `read()` text is byte-identical to the prior unbounded behavior except for that one marker, and `log()` never consumes — both pinned by the registry spec.

### The wire: `jobs.log`

A unary method on the existing `jobs` domain of the host ApiProxy, request `{ sessionId, jobId }`, response `{ text, truncated }`. The requesting session's live Agent is the fence caller, resolved exactly like the `session/jobs` frames (`ctx.agents.get(sessionId)`, so a cold session reads only unowned jobs and is never resumed). An unknown id answers the new `job-not-found` code (details `sessionId` + `jobId`), a foreign job `job-unauthorized` (details `jobId`), and a deployment without the registry `internal`. The Host tail-bounds every response to `JOB_LOG_WIRE_TAIL_BYTES` (256 KiB) of UTF-8 — a protocol constant, not a config field — walking code points from the end so a multibyte character never splits; `truncated` flags the cut.

### The client: row click → details seat

Every row of the [ui-jobs](../../../../packages/client/ui-jobs/README.md) list is a button. A click closes the popover and opens the details panel on `{ turnSeq: 0, jobId }` through ui-conversation's `detailsPanel` service — the same sanctioned cross-plugin gesture face the Files action uses, so ui-jobs reaches neither the chat store nor the layout. The selection channel gains `jobId` as a fourth mutually exclusive, `callId`-less field alongside `filePath` and `browse`; persisted targets older than the field rehydrate as a no-op selection, like the earlier fields.

The details panel declares one more seat, `conversation.details.job`, and renders it keyed by `jobId` so the occupant's state resets between targets. [`ui-jobs`](../../../../packages/client/ui-jobs/README.md) occupies the seat: a status line from the same `jobsBySession` mirror the header list reads (marker, kind, label, `detail` over status) over the retained log, fetched once on mount and refetched every 1500 ms while the mirror says the job is live, plus one final read when the settle flip lands, then silent. A `job-not-found` answer renders the released state, any other failure a generic note, the host's tail cut a truncation note, and an empty live log a placeholder.

## Alternatives considered

**Poll `read()` from the browser.** Rejected: it consumes the cursor and marks the job reported, so the browser would steal the model's `job_output` bytes and suppress the completion notice — exactly the delivery the cursor exists to protect.

**A second producer subscription or side channel for the human read.** Rejected: the producer protocol has one `readOutput`, and a second drain point would need its own delivery and ordering story inside every producer plugin. Teeing the single consumption point keeps producers untouched.

**Push the log bytes over the mux.** Rejected: bytes are large and chatty, and the status frames already push. Pull with a bounded interval while the panel is open costs nothing while it is closed; the 1500 ms interval is a UI constant, not a deployment choice.

**A `JobSnapshot.logTail` field on the `session/jobs` frame.** Rejected: it would ship every job's bytes to every subscribed session for a surface only one panel reads, and the frame's job is the authoritative status set.

## Testing

- `dsh-jobs-local` spec: byte-identical model reads, non-consuming human reads, no report claimed, final-output semantics, the tail cap with a one-shot marker, the shift-without-redelivery case, the marker re-arming after a second drop, and the fence.
- Host ApiProxy spec: ok path with the model cursor untouched, `job-not-found`, `job-unauthorized`, no-registry `internal`, the UTF-8 tail bound on a multibyte payload, the final-output job's live-then-settled read, and a cold session reading an unowned job without resuming it.
- RPC schemas spec: the two new error-code branches with their required details.
- ui-jobs component specs: the panel's poll-while-live / final-read-on-settle machine, the released and failed states, the truncation note, and abort on unmount; the row click's open gesture and accessible name.
- Real-stack seat spec: the occupant lands through the slot machinery, a job selection routes to it, and a header row click opens it through the `detailsPanel` service.
- The [web e2e scenario](../../../../apps/web/tests/background-job-list.e2e.ts) gains a details-panel capture; its command now prints 50 lines before holding, and the list goldens re-record because a row is now a button.

## Consequences

**Each streaming job now retains up to the cap of log text.** The registry previously kept no human view at all; a long job holds ~2 MiB of UTF-16 text in memory until owner disposal releases it. The cap is configuration for deployments that want more or less.

**The retention mechanism can surface in model text.** Only when a head-drop swallowed bytes the model had not consumed does the model see `[job log head dropped]` — once per drop episode — and the retention cap becomes a model-visible fact for very chatty jobs.

**Human reads drain the producer.** `log()` and `read()` both pass through the single consumption point, so an open panel pulls the producer's output forward — the same bytes the model would have gotten on its next read, now accumulated for both.

**The panel shows the tail.** Responses over 256 KiB on the wire show only the most recent part, flagged by `truncated`; the retained head beyond the wire bound is not recoverable from the browser.

**No cancellation in the panel.** Rows open the log, not a stop control. The model-facing consequences of a human cancellation (`kill()` marks terminal delivery reported, so the model would believe its job is still running) remain the decision that phase owes.
