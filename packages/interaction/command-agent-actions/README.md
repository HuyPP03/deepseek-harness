# @deepseek-ai/dsh-command-agent-actions

English | [中文](README.zh.md)

Human-facing `/simplify` and `/code-review` over the code a session has changed. The plugin registers two commands through [`ctx.commands`](../../interaction/commands/README.md) and uses the agent's steering seam plus the [`ctx.subagents`](../../subagent/subagent/README.md) service: `/simplify` steers the receiving agent to simplify the code the session touched, and `/code-review` starts four one-shot reviewer children in parallel (correctness, security, performance, maintainability) on a configured provider, folding their findings into one report-only result. The review scope is derived from the session log alone: the `file_path` of every `edit`/`write` tool call, in first-touched order.

## Command contract

| Input | Result |
|---|---|
| `/simplify` | Steers the agent with a behavior-preserving simplification directive. An idle agent starts a turn; a running agent consumes the steering at its next step boundary. `Simplification queued for this session.` |
| `/simplify <args>` | `Usage: /simplify (no arguments)` |
| `/code-review` | Four one-shot reviewer children on the configured provider, one per facet, started in parallel. Their findings fold into one report; no result text instructs edits. |
| `/code-review` (no recorded edits) | `No code changes were found in this session to review.` — a success, not an error. |
| `/code-review` (provider absent) | The configured provider is not registered, so the review is queued as one steering message on the receiving agent instead; the result says so. |
| `/code-review <args>` | `Usage: /code-review (no arguments)` |

Each reviewer prompt lists the changed files (capped at 100 paths) and its single facet, and asks for file-and-line citations with no modifications. The report keeps one section per facet in fixed order, notes a facet whose child did not complete, appends a `## failed facets` section when a start failed, and cuts to a 32 KiB byte budget with a truncation marker. Cancellation is owned by the command executor: an aborted request settles the `command/done` pair as the abort, and the published runs are disposed when the handler settles.

## Composition

The plugin injects `commands` and `subagents`. Mount the command registry, the subagent service (whose providers come from the host bundles), and this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: subagents
  name: '@deepseek-ai/dsh-subagent'
- id: command-agent-actions
  name: '@deepseek-ai/dsh-command-agent-actions'
```

`/code-review` starts its children on the `provider` config field's provider (default `spawn`); deployments that register another review transport set that field on this row. The shipped `dsh` presets mount it in the `standard` and `code` agent presets; the `chat` preset does not, because a chat session has no code changes to review or simplify. Plugin disposal first unregisters both commands, then drains every handler that already started, so root teardown cannot outlive a review that is still running.

## Model Experience

### Human steering into the loop

#### What the model sees

`/simplify` and the `/code-review` fallback each send one steering message to the receiving agent: the model meets that composed directive (source `plugin: command-agent-actions`) in its next turn. Each of the four parallel reviewers sees its own single-facet prompt plus the changed file list. The folded report text never enters a model request — it is the human's result card, settled through the log-only `command/run` / `command/done` pair.

#### Token effect

One `/simplify` steering adds one directive message to the next turn's context (and the log it appends to). One `/code-review` run adds four short child contexts on the provider side (each facet prompt plus the child's own work) and no tokens to the receiving agent's requests; only the fallback path costs a steering message there.

#### KV Cache effect

The steering message extends the receiving agent's prefix after its last step boundary, so prefix cache reuse holds until that boundary. The four parallel children own their own prefixes and do not touch the parent's cache.

## Known Limitations and Deferred Work

- **Scope is edit/write only** — the review scope is the `file_path` of `edit`/`write` tool calls; a session that changed files through `bash` (or made no tool calls) reports no reviewable content.
- **Reviewer constraint is prompt-level** — children run with their deployment's normal tools; "report only" is the instruction in each facet prompt, not a tool filter. Enforcement via the `toolFilter` capability is deferred until a deployment needs it.
- **No diff context** — children receive the changed file list and read the files themselves; the pre-change state is not quoted, so a review of a rewritten file reasons over current content.
- **Fixed report budget** — the 32 KiB folded-report cap and the 100-path prompt cap are protocol constants, not deployment config.
