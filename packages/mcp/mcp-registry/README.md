# @deepseek-ai/dsh-mcp-registry

English | [中文](README.zh.md)

Shared registry over the live [`mcp-client`](../mcp-client/README.md) instances in one app: each client reports its server's connection state and registered tools, [`/mcp`](../command-mcp/README.md) reads a snapshot, and the model reaches every MCP tool on demand through the registry's bridge. The registry owns no connection and no tool lifecycle of its own; the per-server tool definitions it dispatches belong to the mcp-client instances.

## Service API

| Method | Returns |
|---|---|
| `report(serverName, reporter)` | disposer that removes the reporter; throws on a duplicate live `serverName` |
| `servers()` | the current views of every reporter, sorted by `serverName` |
| `reconnect(serverName)` | resolves once the reporter's manual reconnect hook has settled; a reporter without a hook is a no-op; throws `McpServerNotReportedError` when no server reports the name |

The `reconnect` hook is optional in `McpServerReporter`: a backend that cannot start an explicit retry simply omits it, and the registry passes the call through without interpreting the result — the hook's own settlement is the completion signal, and the next `servers()` read observes the new status.

A reporter holds a **reader closure** that computes the current `McpServerView` on demand:

```ts
interface McpServerView {
  serverName: string
  status: 'connecting' | 'connected' | 'reconnecting' | 'down'
  tools: readonly { name: string; description: string }[]
}
```

Pull semantics are deliberate. The mcp-client's supervisor mutates its internal state at every reconnect transition; a push at each transition would couple the two packages to the supervisor's event ordering. Instead, `servers()` pulls every reader at read time, so a read during a re-sync never observes a partial generation, and a reader that yields nothing (post-disposal) is simply absent from the snapshot.

## Model bridge

Once per app, the registry registers three listed tools on `ctx.tools` (registered as ctx effects, so disposing the registry removes them). They give the model on-demand access to the MCP tools without their schemas ever entering a request `tools` array — the mcp-client registers each per-server tool as an `unlisted: true` definition (dispatchable, model-invisible), so a server advertising hundreds of tools cannot overflow the context window:

| Tool | Purpose |
|---|---|
| `mcp_list` | Every connected server with its tools' public names and one-line descriptions; an optional `server` argument narrows to one server |
| `mcp_describe` | One tool's description and full input schema, by public name |
| `mcp_call` | Dispatches one tool by public name with arguments matching the described schema, and returns the tool result content |

The model's flow is list → describe → call. `mcp_call` dispatches through the ToolRuntime under the exact public name (`mcp__<serverName>__<rawName>`), forwarding the caller's agent, the nested `parent` token, and the signal — so the session log records the same call, arguments, and result a direct tool call would have, and Code Mode legality is preserved. A `mcp_call` target that is not a registered `unlisted` MCP definition is rejected; an inner failure surfaces as the bridge call's own error.

## Composition

The base bundle mounts the registry so every `mcp-client` instance in any preset reports into the same one. `mcp-client` reads the registry through an optional `ctx.get('mcpRegistry')` — a deployment without it keeps connecting and simply reports nowhere:

```yaml
- id: mcp-registry
  name: '@deepseek-ai/dsh-mcp-registry'
```

Because the registry is app-scoped, `/mcp` in a preset sees exactly the servers that preset's app connected; it is a status view of this deployment, not a catalog of everything that could be connected.

## Model Experience

### The MCP bridge tools

#### What the model sees

The three bridge definitions (`mcp_list`, `mcp_describe`, `mcp_call`) in its `tools` array. The per-server MCP tools themselves never appear there: the mcp-client registers them `unlisted`, so the model learns one tool's name and description from `mcp_list`, its input schema from `mcp_describe`, and calls it with `mcp_call`. Each `mcp_call` is logged under the exact public MCP name with its real arguments and result.

#### Token effect

Three small fixed schemas, independent of how many tools the connected servers advertise. Previously the full JSON schema of every MCP tool was sent with every request — a server advertising hundreds of tools could push the request past the model's context window before any conversation tokens. On-demand `mcp_describe` calls pay the schema of one tool only when the model asks for it.

#### KV Cache effect

The bridge schemas are registration-stable (they do not depend on the reported servers), so connecting, reconnecting, or disposing MCP servers cannot invalidate the prefix through them; the unlisted per-server definitions occupy no prefix position at all.

## Known Limitations and Deferred Work

- **Point-in-time snapshot** — `servers()` reflects each reporter's state at read time; a status that changes mid-list (e.g. a server flapping between `connected` and `reconnecting`) is reported per server as each reader is pulled, with no transaction across servers.
