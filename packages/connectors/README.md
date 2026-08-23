# connectors/ — predefined external connections

English | [中文](README.zh.md)

The connectors family turns external SaaS and self-hosted services into named, configurable connections:

| Package | Role | ctx key |
|---|---|---|
| [`connectors/`](connectors/README.md) | Connector catalog + state machine over MCP servers, credentials, and OAuth tokens | registers `ctx.connectors` |

A connector manifest names the MCP server(s) a connection mounts, how it authenticates, and which agent preset it composes with. The chat-screen UI lives in `client/ui-connectors`; the wire verbs in `host/apiproxy`.
