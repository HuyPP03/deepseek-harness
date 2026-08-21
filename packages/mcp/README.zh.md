# MCP — 模型上下文协议

[English](README.md) | 中文

将 harness 与 MCP 生态系统桥接的包。

| 包 | 职责 |
|---|---|
| [`command-mcp/`](command-mcp/README.md) | 面向人类的 `/mcp` 命令：列出已连接的 MCP 服务器及其工具 |
| [`mcp-client/`](mcp-client/README.md) | MCP 客户端桥接，将外部服务器工具注册到 `ctx.tools` |
| [`mcp-manager/`](mcp-manager/README.md) | 用户 MCP 服务器：在 `$DSH_HOME/.mcp` 下按服务器持久化 cordis.yml，并在运行时挂载其 mcp-client 实例 |
| [`mcp-registry/`](mcp-registry/README.md) | 共享注册表，各 mcp-client 向它报告服务器状态，`/mcp` 从中读取 |
