# connectors/：预定义外部连接

[English](README.md) | 中文

connectors 家族把外部 SaaS 与自托管服务变成有名字、可配置的连接：

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`connectors/`](connectors/README.md) | 基于 MCP 服务器、凭据与 OAuth 令牌的连接器目录 + 状态机 | 注册 `ctx.connectors` |

连接器清单命名一个连接要挂载的 MCP 服务器、认证方式，以及与之组合的 agent 预设。聊天界面位于 `client/ui-connectors`；wire 动词位于 `host/apiproxy`。
