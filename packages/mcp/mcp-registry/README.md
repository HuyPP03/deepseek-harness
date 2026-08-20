# @deepseek-ai/dsh-mcp-registry

English | [中文](README.zh.md)

Shared registry over the live [`mcp-client`](../mcp-client/README.md) instances in one app: each client reports its server's connection state and registered tools, and [`/mcp`](../command-mcp/README.md) reads a snapshot. The registry is the read face only — it owns no connection, no tools, and no lifecycle of its own.

## Service API

| Method | Returns |
|---|---|
| `report(serverName, read)` | disposer that removes the reporter; throws on a duplicate live `serverName` |
| `servers()` | the current views of every reporter, sorted by `serverName` |

A reporter holds a **reader closure** that computes the current `McpServerView` on demand:

```ts
interface McpServerView {
  serverName: string
  status: 'connecting' | 'connected' | 'reconnecting' | 'down'
  tools: readonly { name: string; description: string }[]
}
```

Pull semantics are deliberate. The mcp-client's supervisor mutates its internal state at every reconnect transition; a push at each transition would couple the two packages to the supervisor's event ordering. Instead, `servers()` pulls every reader at read time, so a read during a re-sync never observes a partial generation, and a reader that yields nothing (post-disposal) is simply absent from the snapshot.

## Composition

The base bundle mounts the registry so every `mcp-client` instance in any preset reports into the same one. `mcp-client` reads the registry through an optional `ctx.get('mcpRegistry')` — a deployment without it keeps the bridge unchanged and simply reports nowhere:

```yaml
- id: mcp-registry
  name: '@deepseek-ai/dsh-mcp-registry'
```

Because the registry is app-scoped, `/mcp` in a preset sees exactly the servers that preset's app connected; it is a status view of this deployment, not a catalog of everything that could be connected.

## Model Experience

### None

#### What the model sees

Nothing. `ctx.mcpRegistry` and its consumers (the mcp-client reporter, the `/mcp` command) are host-side: no prompt, tool schema, or session event references the registry.

#### Token effect

Zero — the registry contributes no model tokens.

#### KV Cache effect

None — the registry does not touch the model-facing prefix.

## Known Limitations and Deferred Work

- **Point-in-time snapshot** — `servers()` reflects each reporter's state at read time; a status that changes mid-list (e.g. a server flapping between `connected` and `reconnecting`) is reported per server as each reader is pulled, with no transaction across servers.
