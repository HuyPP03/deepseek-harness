# @deepseek-ai/dsh-client-ui-slash-tools

English | [中文](README.zh.md)

Web slash-tool feature owner: contributes the client-owned `/clear` ACTION to `ctx.commandUi`. A menu pick or a bare enter mints a fresh blank session in the current session's Workspace (account membership, never cwd) and its agent preset (when the deployment composes one), then opens it; the current session stays in the list untouched.

The action is offered only on a session with something to clear — a blank current session has no conversation to discard — and re-checks that at run time. A chat session (no Workspace membership, no preset) mints a bare session. The new session does not carry the current one's reference Workspaces: the list summary carries no reference axis, so the action cannot see them.

The action kind has no result channel: a refused create is logged by the command service, never announced.

## Model Experience

### Clearing a session

#### What the model sees

Nothing in this package is model-visible. The effect is indirect: the fresh session's first prompt carries no conversation history — only the deployment system prompt, the Workspace files it resolves, and the user's next message.

#### Token effect

The conversation prefix resets to zero; the next turn pays only its own prompt plus the deployment baseline.

#### KV Cache effect

The fresh session's first request starts a new provider prefix, so provider-side cache reuse does not cross the clear; the deployment and Workspace-prompt share may still hit.

## Known Limitations and Deferred Work

- **Reference Workspaces are not carried over** — the list summary carries no reference axis, so a session cleared with references loses them; the fresh session joins its Workspace bare.
- **Failures are log-only** — the action kind has no result channel; a refused create is only logged, not announced.
