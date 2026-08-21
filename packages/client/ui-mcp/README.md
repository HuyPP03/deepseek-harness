# dsh-client-ui-mcp

English | [中文](README.zh.md)

The MCP server surfaces: a settings section that lists every MCP server reporting into the host — with per-row reconnect, remove for user-added servers, and the add form — and the `/mcp` decoration, which turns the host command's bare invocation into a roster popup.

## The MCP settings section

A settings page (`settings.section` id `mcp`, ordered after the other feature sections — wiring in an external tool server is deployment-level work, not per-session configuration). The roster is a pull of the host's `mcp.list`: every reported server, profile-declared and user-managed alike, sorted by name, each row showing its lifecycle state and the tools it currently registers.

- **Reconnect** asks one reported server to drop and re-establish its connection. A server that cannot reach its endpoint enters its own reconnect loop on the host and stays listed while recovering, so the row's state is the truth about the connection, not the button.
- **Remove** exists only for user-managed rows (`managed: true`). Profile servers are declared by the deployment — the page has no action for them at all, rather than a button that would refuse on the wire.
- **Add** collects the server definition as raw text fields (name, transport, command or URL, arguments, environment, headers, timeout) and parses them into the wire spec at submit: the host re-validates the name and the mount, and a refused add keeps the form open on the host's answer. A server that cannot connect on add is still added — it appears in its own lifecycle state while recovering.

## The /mcp decoration

The host keeps the `mcp` command's catalog row, argument claim, and lifecycle; the decoration replaces only the bare invocation. The popup lists each reported server with its state and tool count as the row detail. Picking a server row gates behind the shared confirmation — the gate is the status read the user asked for, and confirming it runs the same reconnect the section button runs. A trailing row opens the MCP settings section through the panel controller, the only place a server is added.

The read is loopback-agnostic; the writes are not. `mcp.add`, `mcp.remove`, and `mcp.reconnect` are privileged wire calls, pinned to loopback by the connection layer, while `mcp.list` is secret-free and public — no URL, header, or credential crosses the wire in the roster.

## Model Experience

Indirectly, through the servers a user adds: their tools become model-visible as soon as the host registers them, and [`dsh-mcp-client`](../../mcp/mcp-client/README.md) owns what those tools look like in front of the model.

#### KV Cache effect

No direct invalidation. Removing a server unregisters its tools for sessions composed afterwards; a session already running keeps the tool set its prefix was built with.

## Known Limitations and Deferred Work

- **No live server watch** — the roster re-reads after the page's own mutations and on first render; a server that recovers or degrades on its own is visible after the next pull, not on the event.
- **One reconnect at a time** — a second press while one is in flight is a no-op; the roster re-read after the first one answers what the second would ask.
- **The add form is loopback-only** — on a non-loopback page the privileged calls are refused by the connection layer, so adding or removing a server requires a local browser against the host.
