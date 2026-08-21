# @deepseek-ai/dsh-mcp-manager

English | [中文](README.zh.md)

User MCP server manager: the owner of the user-added MCP servers in one app. Each user server is persisted as one `<serverName>.cordis.yml` file under the harness home's `.mcp/` directory (default `$DSH_HOME/.mcp`) holding a single `mcp-client` entry, and mounted as a live [`dsh-mcp-client`](../mcp-client/) instance at startup and on `add`. Servers declared in the profile or host composition are not user servers — the manager never touches them — but every server (both origins) reports into the shared [`dsh-mcp-registry`](../mcp-registry/), and the manager's `servers`/`reconnect` faces read that union directly.

## Usage

Mounted in the base composition (`packages/bundle/base/cordis.patch.yml`):

```yaml
- id: mcp-manager
  name: '@deepseek-ai/dsh-mcp-manager'
```

### Persisted server documents

One file per user server, holding a single `mcp-client` entry:

```yaml
# $DSH_HOME/.mcp/websift.cordis.yml
- id: mcp-client-websift
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: websift
    transport: streamable-http
    url: http://192.168.161.79:8787/mcp
```

Documents are written `0600` (headers and env may carry secrets); the directory is `0700`. An unparsable document fails the boot loud, like any other composition input; an `add` whose mount fails deletes the document it just wrote.

### Service API

| Method | Returns / throws |
|---|---|
| `servers(): readonly McpServerView[]` | every reported server (profile + user), sorted by `serverName` |
| `userServers(): readonly string[]` | the sorted serverNames the manager mounts from its own directory |
| `add(spec: McpServerSpec): Promise<void>` | persists and mounts one server; refuses when the `serverName` is taken by any live instance or the mount fails, rolling back the document |
| `remove(serverName: string): Promise<void>` | unmounts the instance and deletes its document; refuses servers that are not user-managed |
| `reconnect(serverName: string): Promise<void>` | manual reconnect for any reported server (any origin); refuses unreported names |

The host RPC surface (`mcp.list` / `mcp.add` / `mcp.remove` / `mcp.reconnect` on the API proxy) wraps these faces; the manual-reconnect connection supervisor they rely on lives in the [mcp-client](../mcp-client/) README.

## Config

| Field | Required | Description |
|---|---|---|
| `mcpDir` | no | Directory holding one cordis.yml per user server; defaults to `.mcp` under the harness home (`$DSH_HOME` / `~/.dsh`) |

## Model Experience

Indirectly, through the `mcp-client` instances it mounts and unmounts: the tools they discover appear and disappear with them, and their token and KV-cache cost belongs to the client serving them.

#### KV Cache effect

`add` and `remove` are user-initiated host operations that produce no session events, so a roster change reaches sessions composed afterwards rather than a running conversation.

## Known Limitations and Deferred Work

- The manager is per-process; concurrent apps sharing one `$DSH_HOME` may edit `.mcp/` simultaneously (last write wins per file, no locking).
- `add` mounts the instance synchronously: an unreachable server is still added and enters the mcp-client reconnect loop (observable through `servers()`).
