# Agent Note: `/search` — steer the agent instead of running ripgrep

Status: implemented

English | [中文](2026-08-21-search-command-steers-the-agent.zh.md)

## Problem

The first `/search` implementation (see [the archived ripgrep command](../../archived/feature/2026-08-20-search-command-ripgrep-over-workspace-references.md)) executed a literal `rg -F` over the project directory and reference projects and printed the matches: up to 200 lines of `file:line: text`. A user asking "where is this?" usually does not know the literal string, and a raw match dump cannot answer a question like "where does the token refresh logic live" — no line count, byte fold, or deadline fixes that, because ranking and explaining matches requires judgment the host command never had.

## Decision

`@deepseek-ai/dsh-command-search` no longer executes anything. It composes the user's query into a **search directive** and **steers** the receiving agent with it: the command result is the fixed line `Search queued for this session.`, and the steer arrives as a user message the agent receives with source `{ kind: 'plugin', plugin: 'command-search' }`. The agent's own turn is the search — it runs its file tools (`grep` for content, `glob` for paths, `read` to confirm), de-duplicates paths, orders the list by relevance, and replies with a concrete file list, each path with a one-line note on why it matches, or says in a single line that nothing matched.

The query is free text, not a literal pattern: the agent interprets it and chooses how to search. An idle agent starts the turn immediately; a running agent consumes the steer at its next step boundary. The directive, the tool calls, and the list all sit in the session log, so the model-visible-is-logged rule holds without a new event.

## Alternatives considered

- **Keep ripgrep and format its output better** (group by file, rank by hit density). Rejected: a host-side ranking heuristic still cannot answer conceptual queries — the user's phrase rarely appears verbatim — and it duplicates, worse, the model's own search judgment.
- **A host tool that returns ranked files to the model.** Rejected: ranking needs the model's intent, and running the search as a tool call from inside a command would duplicate the agent loop the steer already drives.
- **Steer silently, no command result.** Rejected: the user needs the command to settle; `Search queued for this session.` tells them the list is coming as a reply instead of arriving in the command result.

## Consequences

- Supersedes [the ripgrep `/search` note](../../archived/feature/2026-08-20-search-command-ripgrep-over-workspace-references.md) (archived in this change): the literal-query rule, the 200-match cap, the 16 KiB fold, the 30 s deadline, and the 256 KB stdout cap no longer exist; the search turn's own limits bound the work.
- The scope narrows to the session's project directory: the steered agent's file tools are sandboxed to it, and reference projects are not granted to them in the default sandbox mode — the ripgrep implementation reached the references, the steer does not.
- The command is now one steer per invocation with no flags; a narrower or broader sweep is a different query.
- Web and CLI inherit the same behavior from the single host command; no client surface is involved.
