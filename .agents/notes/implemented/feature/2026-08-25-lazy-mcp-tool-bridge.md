# Agent Note: Lazy MCP tool access — unlisted tools and the mcp-registry bridge

Status: implemented

English | [中文](2026-08-25-lazy-mcp-tool-bridge.zh.md)

## Problem

The [mcp-client plugin](2026-07-07-mcp-client-plugin.md) registered every discovered MCP tool as a model-visible native tool with its full JSON Schema in the request `tools` array. A single connected server can advertise a large tool surface: a real Microsoft 365 deployment exposed 188 tools whose schemas totaled ~1 MB (~254K tokens), pushing every request past the local provider's 262144-token window before a single conversation token — a brand-new chat with one message failed with `CONTEXT_WINDOW_EXCEEDED`. Every connected server makes the request cost grow with its tool count, regardless of which tools the conversation uses.

## Decision

MCP tool schemas are model-invisible by default; the model discovers and calls them on demand through three small fixed tools.

### `unlisted` ToolDefinition flag (`dsh-tools`)

`ToolDefinition` gains an optional `unlisted: boolean`. An unlisted definition stays registered, resolvable by `get()`, and dispatchable by `execute()` (prompt-order validation via `knownNames` keeps its name), but is excluded from every model-facing projection: `schemas()`, `sdkSchemas()`, and both `wireSchemas()` arms (native and Code Mode) filter it through one `modelListed()` pass. The flag is a registration attribute, not a scope: it applies wherever the definition is registered.

### Per-server tools registered unlisted (`mcp-client`)

The mcp-client's `createDefinition` now emits `unlisted: true` on every per-tool definition. Everything else — public-name derivation, re-sync generations, executor, image projection, canonical MCP result — is unchanged; the tool is simply invisible to the model's `tools` array.

### The model bridge (`mcp-registry`)

The registry — already mounted in the base bundle and already the owner of the live server catalog — registers three listed tools once per app, each on a `ctx.effect` so disposing the registry removes them:

- `mcp_list` — every connected server with its tools' public names and one-line descriptions; optional `server` filter; unknown server names are an error that lists the connected servers.
- `mcp_describe` — one tool's description and full input schema by public name; unknown or non-MCP names are errors.
- `mcp_call` — dispatches one tool by public name with arguments matching the described schema, returning the tool result content.

`mcp_call` dispatches through the ToolRuntime under the exact public name, forwarding the caller's `agent`, the nested `parent` token, and the signal — the session log therefore records the same `mcp__<serverName>__<rawName>` call, arguments, and result a direct tool call would have, Code Mode legality is preserved (the bridge call is a normal listed tool; the inner dispatch is a nested call with a `parent`), and the mcp-client's own executor, output validation, image projection, and failure semantics all run. The target face admits only registered `unlisted` definitions whose names carry the `mcp__` prefix, so the bridge cannot reach native tools or squatting names; an inner failure surfaces as the bridge call's own error, and an inner success without the MCP result vocabulary is rejected.

The model's flow is list → describe → call: the name and one-line description cost a few tokens per tool at most (and only for servers the model asks about), the full schema is paid once per tool when it is actually needed, and no tool schema occupies the request prefix at all.

## Alternatives considered

- **Cap the tools per server** — arbitrary and silent: the model loses access to uncapped tools with no signal, and the cap still multiplies by server count. Rejected.
- **A single opaque `mcp` tool that takes a free-form command** — one schema, but the model loses per-tool names, descriptions, and schema-checked arguments; the session log would no longer name the exact tool; permission and telemetry shapes (`mcp__*`) break. Rejected.
- **An MCP subagent that holds the schemas** — moves the cost into a second model conversation instead of deleting it, adds a delegation hop per tool use, and splits the permission surface. Rejected.
- **Prompt-only discovery (system-prompt annotation of tool names)** — the names would enter the prefix, the model has no typed way to fetch one schema on demand, and the annotation desynchronizes from re-syncs. The three tools do the same job through the existing dispatch pipeline. Rejected.
- **Keep schemas visible and let the user disconnect bloated servers** — the incident was exactly a legitimately-connected server; the fix cannot depend on the user avoiding useful servers. Rejected.

## Consequences

- A connected server's tool count no longer scales request tokens; the fixed cost is the three bridge schemas, and re-syncing an unlisted generation cannot invalidate the model prefix.
- Using one MCP tool costs two extra round trips (list, describe) before the call. Accepted: describe is paid once per tool per conversation, and list narrows to one server on request.
- The `unlisted` seam is generic — any plugin can register dispatch-only tools — but the MCP bridge is its only consumer today.
- The naming, identity, and wire decisions of the [mcp-client plugin note](2026-07-07-mcp-client-plugin.md) are unchanged: the same public names, the same raw name on the wire, the same session-log entries.
- A model that does not discover (never calls `mcp_list`) sees no MCP tools — the connection is present in `/mcp` and the UI but inert in the conversation. This is the intended trade for bounded request cost.
