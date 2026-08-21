# Agent Note: `/mcp` — a status view over the live MCP client instances

Status: implemented

English | [中文](2026-08-20-mcp-status-command.zh.md)

## Problem

Every MCP server the deployment connects through `@deepseek-ai/dsh-mcp-client` was invisible to the person operating the session. The tools appear in the model's catalog, but a human had no way to answer "which MCP servers are connected, are they healthy, and what did each of them give the model?" — the answer lived only in Host log lines emitted at connect, reconnect, and give-up.

## Decision

Three packages, one read face:

- **`@deepseek-ai/dsh-mcp-registry`** — a new app-scoped service, `ctx.mcpRegistry`, with two methods: `report(serverName, read)` (register a reader closure, returns its disposer) and `servers()` (pull every reader, sort by `serverName`, drop readers that yield nothing). The registry owns no lifecycle and no pushed state; it is the read face only.
- **`@deepseek-ai/dsh-mcp-client`** — the supervisor gains a `report(): McpServerView | undefined` on the connection handle that derives `{ serverName, status, tools }` from the state it already owns: `client` + `connectedAt` decide `connecting` vs `connected`, an armed `reconnectTimer` is `reconnecting`, a terminal `stopped` flag (reconnect disabled or budget exhausted) is `down`, and disposal yields nothing. `syncTools` now returns the generation's tool snapshot alongside its disposers, so the report never re-derives names from the registry. `apply` reads `ctx.get('mcpRegistry')` optionally and registers the reporter in an effect when present — a deployment without the registry is unchanged.
- **`@deepseek-ai/dsh-command-mcp`** — the human-facing `/mcp [server]` command: one block per reported server (`name (status) — N tools:` + one line per registered tool), a no-servers notice, a single-server narrowing, and an error that names the available servers. Result is executor-owned: log-only `command/run` / `command/done`, never model history.

The base bundle mounts the registry and the command, so `/mcp` exists in every preset and every mcp-client instance in any preset reports into the same registry.

## Alternatives considered

- **`/mcp` as an mcp-client subcommand** (`/mcp` owned by the bridge). Rejected: the bridge is per-server (one plugin instance per server) while the listing is per-app, and the base bundle does not mount the bridge at all.
- **`/mcp` derived from the tool registry** (scan `ctx.tools` for `mcp__` names). Rejected: tool names carry no server status (a `down` server keeps no tools but is not distinguishable from one that never had any), and normalized public names are lossy, so the server grouping cannot be reconstructed.
- **Push-based reporting** (the bridge calls `registry.update(...)` at each transition). Rejected: it would duplicate the supervisor's transition points as a second writer; pull-on-read makes a mid-re-sync read always observe a complete generation.

## Consequences

- `mcp-client` gains an optional `mcp-registry` peer; its `SyncGeneration` return type is public surface for the reporter, not an accident.
- The registry is realm-isolated like every Cordis service: an mcp-client mounted in a preset reports into that preset's registry, so `/mcp` inside the preset sees only that preset's servers.
- The Web now has a client surface over the same read face: the MCP settings section and the `/mcp` popupSelect decoration in `@deepseek-ai/dsh-client-ui-mcp`, which pull from `mcp.list` exactly as the command does (see [the `/mcp` Web surface note](2026-08-21-mcp-client-surface-and-settings-panel-deep-link.md)).
- The snapshot is point-in-time per server; a flapping server reports whatever its reader computes when its turn in the sorted read comes.
