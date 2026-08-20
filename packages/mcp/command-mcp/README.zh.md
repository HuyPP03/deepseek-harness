# @deepseek-ai/dsh-command-mcp

[English](README.md) | 中文

面向人类的 `/mcp` 控制面，覆盖本部署已连接的 MCP 服务器。插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册一个命令并读取共享的 [`mcpRegistry`](../mcp-registry/README.md) 快照，让人类无需模型轮次即可列出已连接的服务器、其连接状态以及各自注册的工具。

## 命令契约

| 输入 | 结果 |
|---|---|
| `/mcp` | 每个已上报服务器一个块，按 `serverName` 排序：`name (status) — N tools:`，每个已注册工具一行 `  - <public tool name> — <description>`。无描述的工具只渲染名称。 |
| 无服务器上报名单的 `/mcp` | `No MCP servers are connected.` |
| `/mcp <server>` | 该服务器的单个块。 |
| `/mcp <server>` 且无已注册工具 | `name (status) — no tools` |
| `/mcp <unknown server>` | 错误 `Unknown MCP server "<name>"` — 有上报名单时列出可用服务器。 |

状态词即 supervisor 自身状态：`connecting`（初始或重连尝试进行中）、`connected`、`reconnecting`（退避等待）或 `down`（断连后重连被禁用，或尝试预算耗尽）。命令结果由执行器持有：通过仅日志的 `command/run` / `command/done` 对结束，不进入模型历史。

## 组合

命令注入 `commands` 与 `mcpRegistry`。基础 bundle 同时挂载二者，因此 `/mcp` 在每个 preset 都可用：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: mcp-registry
  name: '@deepseek-ai/dsh-mcp-registry'
- id: command-mcp
  name: '@deepseek-ai/dsh-command-mcp'
```

每个 [`mcp-client`](../mcp-client/README.md) 实例都会把自身报告到已挂载的注册表；插件 disposed 时移除该条目，因此清单跟随存活实例。

## 模型体验

### 人类 `/mcp` 控制

#### 模型看到什么

斜杠输入与结果文本都不进入模型请求。命令与其他人类命令一样通过仅日志的 `command/run` / `command/done` 对结束；会话 surface 与派生消息中没有任何内容。

#### Token 影响

无论是否匹配，命令都不增加模型 token。

#### KV 缓存影响

命令不触及面向模型的 prefix，缓存复用不受影响。

## 已知限制与延期工作

- **只有状态，没有诊断** — 清单报告 supervisor 的生命周期状态与已注册工具集；每次尝试的错误细节留在 Host 日志中（supervisor 已在那里记录）。
- **无远程或跨 app 视图** — `/mcp` 只读取服务该会话的 app 的注册表；其他 preset 或 app 中连接的服务器从它不可见。
