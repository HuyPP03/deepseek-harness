# MCP — Model Context Protocol

English | [中文](README.zh.md)

Packages bridging the harness to the MCP ecosystem.

| Package | Role |
|---|---|
| [`command-mcp/`](command-mcp/README.md) | Human-facing `/mcp` command: lists the connected MCP servers and their tools |
| [`mcp-client/`](mcp-client/README.md) | MCP client bridge that registers external server tools on `ctx.tools` |
| [`mcp-manager/`](mcp-manager/README.md) | User MCP servers: persists per-server cordis.yml under `$DSH_HOME/.mcp` and runtime-mounts their mcp-client instances |
| [`mcp-registry/`](mcp-registry/README.md) | Shared registry each mcp-client reports its server state into and `/mcp` reads |
