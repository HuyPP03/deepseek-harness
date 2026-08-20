# Agent Note: `/search` — literal ripgrep over the session workspace and its reference projects

Status: implemented

English | [中文](2026-08-20-search-command-ripgrep-over-workspace-references.zh.md)

## Problem

A human working in a session had no fast textual way to find where a string occurs in the project: the model-facing `grep` tool exists for the model's turns, and reaching for it through a prompt costs a turn, a request, and a wait when the question is "which file says this?". The session's own state already names the places a human would expect such a search to cover — the project directory in its header and the reference projects attached to the session — but nothing exposed them as a one-line search.

## Decision

A new host package, `@deepseek-ai/dsh-command-search`, contributes a `/search <literal text>` command to `ctx.commands`, mounted in the `standard` and `code` agent presets (the `chat` preset has no project directory to search, so it does not mount it). The handler resolves the search roots from session state alone — the header's `cwd` first, then the reference set `referencesOf` replays from the session log — and runs the packaged ripgrep binary ([`@vscode/ripgrep`](../architecture/2026-08-01-packaged-ripgrep-search.md), resolved lazily like the grep tool) once through `ctx.subprocess` with a fixed, defensive argv: `--no-config --fixed-strings -H --line-number --max-count 200 -- <pattern> <roots...>`, the pattern always after `--` so it can never be read as a flag.

The result is bounded three ways and folded into `path:line: text` lines: at most 200 matches (mirrored by ripgrep's per-file `--max-count`), the folded text held to a 16 KiB UTF-8 byte budget (one over-long line is cut to the budget with a `… (line truncated)` marker; when several lines do not fit, the list is re-folded from the tail with a `showing N of M matches` note), and a 30 s deadline that fuses the dispatching UI's cancellation into the ripgrep process tree. ripgrep exit 1 is a success with no matches; any other exit is a direct error with a trimmed stderr tail; a run whose raw stdout exceeds the 256 KiB retention cap fails with a "narrow the pattern or the roots" error rather than parsing a partial stream. Display paths are workspace-relative inside the project directory and as-printed elsewhere.

Cancellation and its `command/done` settlement are owned by the command executor, not the handler: an aborted request records the abort and kills the process tree through the fused signal, and the handler's own abort checks only classify a launch failure that races the abort. The plugin drains in-flight handlers before disposal, mirroring `command-compact`.

## Alternatives considered

- **A flag-taking search (regex, globs, file types).** Deferred. A human one-liner wants literal "find this string"; the model-facing `grep` tool keeps the full ripgrep surface, and adding flags to a human command buys complexity for a case the model already owns.
- **Searching only the session cwd, ignoring reference projects.** Rejected. The session's own state advertises its reference projects to the model; a human search that silently skips the projects the session is attached to would answer a different question than the model's `grep` does over the same workspace.
- **Reusing the model-facing `grep` tool's executor from the command.** Rejected. That executor is bound to a tool execution (schema, policy pipeline, spill files, model-facing presentation); a human command needs a different result surface and different bounds, so a thin command-owned run over `ctx.subprocess` deletes less than it would couple.

## Consequences

- `/search` is a host command: it appears on every command adapter that composes the presets that mount it (CLI and Web alike); automation surfaces without a command adapter keep none of the human commands.
- The search is read-only by construction (ripgrep never writes), so it needs no permission preset and no sandbox consideration beyond the subprocess provider's own policy.
- `@vscode/ripgrep` becomes a direct dependency of the command package; its platform-package resolution stays lazy, so a broken optional platform install fails the first search with a plain command error instead of failing Loader composition — the same standing as the model-facing grep tool.
- The 200-match / 16 KiB / 30 s bounds are protocol constants, not deployment config; the deferred wider-sweep path is a narrower pattern, fewer reference projects, or the model's `grep`/`bash` tools.
- The command settles beside the agent: the slash input, the run, and the result text never enter a model request, so it adds no tokens and does not touch the model-facing prefix or cache reuse.
