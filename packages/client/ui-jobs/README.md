# @deepseek-ai/dsh-client-ui-jobs

English | [中文](README.zh.md)

Web background-job feature owner: contributes one entry to `conversation.session.header.actions` listing the `ctx.jobs` records this session can see, and occupies the `conversation.details.job` seat the details panel renders for a clicked row. The list data arrives entirely through the `jobsBySession` list mirror that [`dsh-client-runtime`](../runtime/README.md) folds from `session/jobs` frames; the log bytes arrive through the connection's `jobs.log` unary.

The trigger renders only when the session has at least one job, so an ordinary conversation never grows a control for a capability it is not using. Its badge counts `running` plus `stopping` and is omitted at zero, leaving a session that holds only finished jobs a quiet entry point into its history rather than one advertising a count of nothing. The popover is a flat list: live rows first by `startedAt` ascending, then settled rows by `finishedAt` descending, with a same-millisecond tie broken on start order so the host's map iteration never decides it. A row shows the producer kind, the label, a status marker, the producer's `detail` in place of the generic status word once it has one, and an elapsed duration. That duration advances once per second while the row is live and freezes at `finishedAt`; the clock runs only while an open list holds something that moves. A settled row missing `finishedAt` reads as zero rather than as a negative figure, and a duration past an hour stays in hours rather than growing a day vocabulary no producer currently reaches.

Settled rows stay visible and de-emphasized until the registry drops them at owner disposal. They are in the snapshot, a failed job's `detail` is the only place its failure is legible, and filtering them out here is work the output and cancellation phases would undo. A running one-shot background subagent therefore appears both here and in the [subagent catalog](../ui-subagent/README.md): the catalog navigates into the child's transcript, while this list is the only handle a future cancellation can attach to.

Every row is a button: a click closes the list and opens the details panel on that job through ui-conversation's `detailsPanel` gesture, so the popover and the panel never share the screen. The panel seat renders a status line from the same `jobsBySession` mirror (marker, kind, label, `detail`-over-status) over the retained log: it reads the log once on mount and refetches every 1500 ms while the mirror says the job is live, plus one final read once the settle flip lands, then stops. A `job-not-found` answer renders the released state, any other failure renders a generic note, the host's tail cut renders a truncation note, and an empty live log renders a placeholder. The seat is keyed by `jobId` in the details panel, so switching jobs discards the previous seat's polling and scroll state.

Escape closes the list and returns focus to the trigger, as does a pointer press outside it. The last job disappearing closes the list before the control unmounts, so focus never vanishes from a removed node. Styling uses tokens only; copy goes through the package's own `job` locale namespace. The behavior is specified by the [Web background-job display Agent Note](../../../.agents/notes/implemented/feature/2026-08-08-web-background-job-display.md) and the [job log details panel Agent Note](../../../.agents/notes/implemented/feature/2026-08-25-background-job-log-details-panel.md).

## Model Experience

None, as this package renders host-computed registry state for a human and touches no prompt, message, schema, stream, or tool result. The model's own view of the same jobs stays with [`dsh-tool-jobs`](../../jobs/tool-jobs/README.md).

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The panel shows the log only** — a human-initiated cancellation is still out of scope. Cancellation additionally owes a model-facing decision the seam does not answer today: `kill()` marks terminal delivery reported, so an interrupt written against the current contract would leave the model believing its job is still running.
- **The list is not the registry's own set** — it shows what one session can see through the wire view, so a job owned by another session never appears here, and a process restart empties the list while the transcript keeps the `run_in_background` cards that started those jobs. An unowned job (one started without a live `Agent`) is the opposite case: it reaches every session's list, matching what `list(caller)` reports to every caller.
