# @deepseek-ai/dsh-command-mcp

English | [中文](README.zh.md)

Human-facing `/mcp` control over the MCP servers this deployment has connected. The plugin registers one command through [`ctx.commands`](../../interaction/commands/README.md) and reads the shared [`mcpRegistry`](../mcp-registry/README.md) snapshot, so a human can list the connected servers, their connection state, and the tools each has registered — without a model turn.

## Command contract

| Input | Result |
|---|---|
| `/mcp` | One block per reported server, sorted by `serverName`: `name (status) — N tools:` followed by one `  - <public tool name> — <description>` line per registered tool. A tool without a description renders name-only. |
| `/mcp` with no servers reporting | `No MCP servers are connected.` |
| `/mcp <server>` | The single block for that server. |
| `/mcp <server>` with no tools registered | `name (status) — no tools` |
| `/mcp <unknown server>` | Error `Unknown MCP server "<name>"` — naming the available servers when any report. |

The status word is the supervisor's own state: `connecting` (initial or reconnect attempt in flight), `connected`, `reconnecting` (backoff wait), or `down` (reconnect disabled after loss, or the attempt budget exhausted). The command result is executor-owned: it settles through the log-only `command/run` / `command/done` pair and never enters model history.

## Composition

The command injects `commands` and `mcpRegistry`. The base bundle mounts both, so `/mcp` is available in every preset:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: mcp-registry
  name: '@deepseek-ai/dsh-mcp-registry'
- id: command-mcp
  name: '@deepseek-ai/dsh-command-mcp'
```

Each [`mcp-client`](../mcp-client/README.md) instance reports itself into the mounted registry; plugin disposal drops the entry, so the listing follows the live instances.

## Model Experience

### Human `/mcp` control

#### What the model sees

The slash input and the result text never enter a model request. The command settles through the log-only `command/run` / `command/done` pair like every other human command; nothing joins the session surface or derived messages.

#### Token effect

The command adds no model tokens, matched or not.

#### KV Cache effect

The command does not touch the model-facing prefix, so cache reuse is unaffected.

## Known Limitations and Deferred Work

- **Status, not diagnostics** — the listing reports the supervisor's lifecycle state and the registered tool set; per-attempt error detail stays in the Host log, where the supervisor already records it.
- **No remote or cross-app view** — `/mcp` reads only the registry of the app that serves the session; servers connected in other presets or apps are not visible from it.
