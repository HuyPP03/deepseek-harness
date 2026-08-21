# @deepseek-ai/dsh-command-search

English | [中文](README.zh.md)

Human-facing `/search` control over the session's own workspace. The plugin registers one command through [`ctx.commands`](../../interaction/commands/README.md) and composes the user's query into a search directive, then **steers** the receiving agent with it. The searching is the agent's own turn — it runs its file-search tools and answers with a concrete list of the matching files, each path with a one-line note on why it matches, instead of a raw dump of match lines. The command result only confirms that the search is queued; the file list arrives as the agent's reply.

## Command contract

| Input | Result |
|---|---|
| `/search <query>` | `Search queued for this session.` — the agent is steered with the search directive, and the file list arrives as the agent's reply. |
| `/search` (no query) | `Usage: /search <query> — asks the agent to search this session workspace and list the matching files` |

The query is free text, not a literal pattern: the agent interprets it (a phrase, a concept, a path fragment) and chooses how to search — content with its `grep` tool, paths with `glob`, confirmation with `read`. The directive instructs it to de-duplicate paths, order the list by relevance, and say so in a single line when nothing matches.

The steer is a user message the agent receives with source `{ kind: 'plugin', plugin: 'command-search' }`. Its turn on that message is the search: the tool calls and the final list are recorded in the session log like any other work. An idle agent starts the turn immediately; a running agent consumes the steer at its next step boundary.

## Composition

The command injects `commands`. Mount the command registry and this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-search
  name: '@deepseek-ai/dsh-command-search'
```

The shipped `dsh` presets mount it in the `standard` and `code` agent presets; the `chat` preset does not, because a chat session has no project directory to search. Plugin disposal first unregisters `/search`, then drains every handler that already started, so root teardown cannot outlive a handler that is still running.

## Model Experience

### Human `/search` control

#### What the model sees

A user message carrying the search directive — the query verbatim plus the fixed instruction copy — with the `command-search` plugin source tag. The model answers it like any other user message: it runs its search tools and returns the file list. The directive, the tool calls, and the list all sit in the session log.

#### Token effect

The directive adds one user message (the query plus ~300 tokens of fixed instruction). The search turn then costs the search work itself: the tool calls and the file list.

#### KV Cache effect

The directive message extends the conversation prefix; the agent's search turn establishes its working state from there.

## Known Limitations and Deferred Work

- **Session workspace only** — the steered agent's file tools are sandboxed to the session's project directory; reference projects are not granted to them in the default sandbox mode, so `/search` does not reach them.
- **One query per invocation** — there are no flags or root filters; a narrower or broader sweep is a different query.
