# Agent Note：`/mcp` —— 存活 MCP 客户端实例的状态视图

Status: implemented

[English](2026-08-20-mcp-status-command.md) | 中文

## 问题

部署通过 `@deepseek-ai/dsh-mcp-client` 连接的每个 MCP 服务器对操作会话的人都是不可见的。工具会出现在模型的目录里，但人类无法回答"连接了哪些 MCP 服务器、它们健康吗、各自给了模型什么？"——答案只存在于 Host 日志里，散落在连接、重连与放弃时的行中。

## 决策

三个包，一个读取面：

- **`@deepseek-ai/dsh-mcp-registry`** —— 新的 app 级服务 `ctx.mcpRegistry`，两个方法：`report(serverName, read)`（注册一个读取闭包，返回其 disposer）和 `servers()`（拉取每个读取闭包，按 `serverName` 排序，丢弃返回空值的读取闭包）。注册表不拥有生命周期，也没有推送状态；它只是读取面。
- **`@deepseek-ai/dsh-mcp-client`** —— supervisor 在连接 handle 上获得 `report(): McpServerView | undefined`，从它已拥有的状态派生 `{ serverName, status, tools }`：`client` + `connectedAt` 区分 `connecting` 与 `connected`，已武装的 `reconnectTimer` 即 `reconnecting`，终态 `stopped` 标志（重连禁用或预算耗尽）即 `down`，disposed 后返回空。`syncTools` 现在返回世代工具快照（与 disposers 一起），因此报告从不从注册表反向推导名称。`apply` 通过可选的 `ctx.get('mcpRegistry')` 读取，存在时在 effect 中注册上报者——未挂载注册表的部署行为不变。
- **`@deepseek-ai/dsh-command-mcp`** —— 面向人类的 `/mcp [server]` 命令：每个已上报服务器一个块（`name (status) — N tools:` + 每个已注册工具一行）、无服务器提示、单服务器收窄、以及列出可用服务器的错误。结果由执行器持有：仅日志的 `command/run` / `command/done`，永不进入模型历史。

基础 bundle 挂载注册表与命令，因此 `/mcp` 在每个 preset 都可用，任意 preset 中的每个 mcp-client 实例都报告到同一个注册表。

## 考虑过的替代方案

- **`/mcp` 作为 mcp-client 子命令**（由桥接拥有）。否决：桥接是按服务器的（每个服务器一个插件实例），而清单是按 app 的，且基础 bundle 根本不挂载桥接。
- **`/mcp` 从工具注册表推导**（扫描 `ctx.tools` 的 `mcp__` 名称）。否决：工具名称不携带服务器状态（`down` 的服务器不保留工具，但无法区分"从未有工具"），且规范化后的公开名称有损，服务器分组无法重建。
- **推送式上报**（桥接在每次转换时调用 `registry.update(...)`）。否决：它会以第二个写者的身份复制 supervisor 的转换点；读取时拉取使 re-sync 中的读取总是观察到完整 generation。

## 后果

- `mcp-client` 新增可选的 `mcp-registry` peer；其 `SyncGeneration` 返回类型是供上报者使用的公开 surface，不是意外。
- 注册表与所有 Cordis 服务一样按 realm 隔离：preset 中挂载的 mcp-client 报告到该 preset 的注册表，因此 preset 内的 `/mcp` 只看到该 preset 的服务器。
- `/mcp` 仅宿主侧（无客户端 surface）：命令文本即呈现，无需 Web/CLI 专门处理。
- 快照按服务器是时点式的；抖动的服务器在排序读取轮到它时报告其读取闭包当时计算的状态。
