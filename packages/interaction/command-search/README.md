# @deepseek-ai/dsh-command-search

English | [中文](README.zh.md)

Human-facing `/search` control over the session's project directory and its attached reference projects. The plugin registers one command through [`ctx.commands`](../../interaction/commands/README.md) and runs the packaged ripgrep binary (`@vscode/ripgrep`) once through [`ctx.subprocess`](../../subprocess/subprocess/README.md), so a human can search the workspace the session was created in — plus every reference project attached to the session — without a model turn. The search roots come from session state alone: the header's `cwd` first, then the reference set [`referencesOf`](../../workspace/workspace-references/README.md) replays from the session log.

## Command contract

| Input | Result |
|---|---|
| `/search <literal text>` | A bounded list of `path:line: text` matches over the session workspace and its reference projects, in ripgrep's output order. Paths inside the project directory display relative to it; paths elsewhere display as printed. |
| `/search` (no pattern) | `Usage: /search <literal text> — searches this session workspace and its reference projects` |
| Session with no `cwd` and no references | `This session has no project directory and no reference projects to search.` |
| Zero matches | `No matches for "<pattern>".` — a success, not an error. |

The pattern is searched **literally** (`--fixed-strings`): special characters need no escaping, and a pattern can never be interpreted as a ripgrep regular expression or a flag (it is always placed after `--`). The run is bounded three ways:

- **Matches** — at most 200 matches are folded into the result (mirrored by ripgrep's per-file `--max-count`);
- **Size** — the folded text holds to a 16 KiB UTF-8 byte budget; one over-long line is cut to the budget with a `… (line truncated)` marker, and when several lines do not fit the list is re-folded from the tail with a `… truncated to fit the result budget (showing N of M matches)` note;
- **Time** — a 30 s deadline fuses the dispatching UI's cancellation into the ripgrep process tree (SIGTERM → 3 s grace → SIGKILL) and reports `Search timed out after 30s.` when it wins.

ripgrep exit 1 (no matches) is a success; any other exit is a direct error carrying a trimmed stderr tail. A run whose raw stdout exceeds the 256 KiB retention cap fails with a "narrow the pattern or the roots" error instead of parsing a partial stream. Cancellation is owned by the command executor: an aborted request settles the `command/done` pair as the abort and kills the process tree through the fused signal.

The search is `--no-config` and honors each root's own ignore files, like the model-facing `grep` tool. Git-ignored and binary files are skipped by default; matched lines are shown as text with no per-file grouping.

## Composition

The command injects `commands` and `subprocess`. Mount the command registry, a subprocess provider, and this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
- id: command-search
  name: '@deepseek-ai/dsh-command-search'
```

The shipped `dsh` presets mount it in the `standard` and `code` agent presets; the `chat` preset does not, because a chat session has no project directory to search. Plugin disposal first unregisters `/search`, then drains every handler that already started, so root teardown cannot outlive a search that is still running.

## Model Experience

### Human `/search` control

#### What the model sees

The slash input, the ripgrep run, and the result text never enter a model request. The command settles through the log-only `command/run` / `command/done` pair like every other human command; nothing joins the session surface or derived messages.

#### Token effect

The command adds no model tokens, matched or not.

#### KV Cache effect

The command does not touch the model-facing prefix, so cache reuse is unaffected.

## Known Limitations and Deferred Work

- **Literal search only** — `/search` takes one literal pattern and no flags (no regex, include/exclude globs, or file-type filters); the model-facing `grep` tool keeps the full ripgrep surface for those cases.
- **Fixed bounds** — the 200-match / 16 KiB / 30 s bounds are protocol constants, not deployment config; a broader sweep is a narrower pattern, a narrower set of reference projects, or the model's `grep`/`bash` tools.
- **No path scoping** — the roots are always the session workspace plus every attached reference project; a per-invocation path or root filter is deferred until a human search needs it.
