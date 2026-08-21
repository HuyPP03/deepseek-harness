# @deepseek-ai/dsh-client-ui-slash-tools

English | [中文](README.zh.md)

Web slash-tool feature owner: contributes two client-owned surfaces to `ctx.commandUi` — the `/clear` ACTION and the `/help` popupSelect. The `/mode` preset-switch popup lives in [`@deepseek-ai/dsh-client-ui-agent-preset`](../ui-agent-preset/README.md), which owns the roster's display copy.

`/clear`: a menu pick or a bare enter mints a fresh blank session in the current session's Workspace (account membership, never cwd) and its agent preset (when the deployment composes one), then opens it; the current session stays in the list untouched. The action is offered only on a session with something to clear — a blank current session has no conversation to discard — and re-checks that at run time. A chat session (no Workspace membership, no preset) mints a bare session. The new session does not carry the current one's reference Workspaces: the list summary carries no reference axis, so the action cannot see them. The action kind has no result channel: a refused create is logged by the command service, never announced.

`/help`: an informational listing of the session's available slash commands — the merged menu face (`CommandUiContract.menuRows`: host catalog + available client contributions, menu order) rendered as `/name` rows with the row descriptions. Picking a row closes the popup; it runs nothing.

## Model Experience

### Clearing a session

#### What the model sees

Nothing in this package is model-visible. The effect is indirect: the fresh session's first prompt carries no conversation history — only the deployment system prompt, the Workspace files it resolves, and the user's next message — because `sessions.create` starts the log with the deployment baseline rather than the cleared conversation.

#### Token effect

The conversation prefix resets to zero; the next turn pays only its own prompt plus the deployment baseline.

#### KV Cache effect

The fresh session's first request starts a new provider prefix, so provider-side cache reuse does not cross the clear; the deployment and Workspace-prompt share may still hit.

## Known Limitations and Deferred Work

- **Reference Workspaces are not carried over** — the list summary carries no reference axis, so a session cleared with references loses them; the fresh session joins its Workspace bare.
- **Failures are log-only** — the action kind has no result channel; a refused create is only logged, not announced.
- **Menu descriptions do not follow locale changes** — the `/clear` and `/help` descriptions are registry-held text read once at registration (the command service refreshes them only on re-registration, not on a locale switch).
