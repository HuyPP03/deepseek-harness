# @deepseek-ai/dsh-mcp-registry

[English](README.md) | 中文

一个 app 内所有存活 [`mcp-client`](../mcp-client/README.md) 实例的共享注册表：每个客户端报告其服务器的连接状态与已注册工具，[`/mcp`](../command-mcp/README.md) 读取快照，注册表的模型桥接（`mcp_list` / `mcp_describe` / `mcp_call`）让模型按需访问所报告的工具。注册表不拥有连接，也不拥有任何服务器生命周期。

## 服务 API

| 方法 | 返回 |
|---|---|
| `report(serverName, reporter)` | 移除该上报者的 disposer；重复的存活 `serverName` 会抛错 |
| `servers()` | 所有上报者的当前视图，按 `serverName` 排序 |
| `reconnect(serverName)` | 在该上报者的手动重连钩子结算后 resolve；没有钩子的上报者是空操作；没有服务器报告该名称时抛 `McpServerNotReportedError` |

`McpServerReporter` 中的 `reconnect` 钩子是可选的：无法发起显式重试的后端直接省略它，注册表透传该调用且不解释结果——钩子自身的结算就是完成信号，下一次 `servers()` 读取会看到新状态。

上报者持有一个**读取闭包**，按需计算当前的 `McpServerView`：

```ts
interface McpServerView {
  serverName: string
  status: 'connecting' | 'connected' | 'reconnecting' | 'down'
  tools: readonly { name: string; description: string }[]
}
```

拉取语义是有意为之。mcp-client 的 supervisor 在每次重连状态变化时都会修改其内部状态；若在每次转换时推送，会把两个包耦合到 supervisor 的事件顺序上。改为 `servers()` 在读取时拉取每个读取闭包，因此重同步期间的读取永远不会看到部分 generation，而上报者在 disposed 后返回空值时，该服务器只是不在快照中。

## 模型桥接

注册表在每个 app 中一次性在 `ctx.tools` 上注册三个 listed 工具（以 ctx effect 注册，销毁注册表即移除）。它们让模型按需访问 MCP 工具，而这些工具的 schema 永不进入请求的 `tools` 数组——mcp-client 把每个服务器工具注册为 `unlisted: true` 的定义（可调度、模型不可见），因此一个上报数百个工具的服务器也不会撑爆上下文窗口：

| 工具 | 用途 |
|---|---|
| `mcp_list` | 列出所有已连接服务器及其工具的公开名称与一行描述；可选 `server` 参数收窄到单个服务器 |
| `mcp_describe` | 按公开名称返回一个工具的描述与完整输入 schema |
| `mcp_call` | 按公开名称调度一个工具，参数须匹配所描述的 schema，返回工具结果内容 |

模型的流程是 list → describe → call。`mcp_call` 通过 ToolRuntime 以确切的公开名称（`mcp__<serverName>__<rawName>`）调度，并转发调用方的 agent、嵌套 `parent` token 与 signal——因此会话日志记录与直接工具调用相同的调用、参数与结果，Code Mode 的合法性也得以保持。指向未注册的 `unlisted` MCP 定义的 `mcp_call` 会被拒绝；内部失败会表现为桥接调用自身的错误。

## 组合

基础 bundle 挂载注册表，使任意 preset 中的每个 `mcp-client` 实例都报告到同一个注册表。`mcp-client` 通过可选的 `ctx.get('mcpRegistry')` 读取注册表——未挂载时桥接行为不变，只是无处报告：

```yaml
- id: mcp-registry
  name: '@deepseek-ai/dsh-mcp-registry'
```

由于注册表是 app 级的，preset 中的 `/mcp` 只看到该 preset app 连接的服务器；它是本部署的状态视图，而非所有可连接服务器的目录。

## 模型体验

### 桥接工具

#### 模型看到什么

三个固定的小工具 schema（`mcp_list`、`mcp_describe`、`mcp_call`），以及每次 `mcp_list` / `mcp_describe` 调用按需返回的服务器目录与单个工具的完整 schema。被调度的 MCP 工具本身不出现在请求的 `tools` 数组中，但其调用、参数与结果以公开名称记录在会话日志里。`ctx.mcpRegistry` 的读取面（mcp-client 上报者、`/mcp` 命令）仍在宿主侧。

#### Token 影响

三个固定小 schema 取代了此前每个服务器随工具数线性增长的 schema 成本；工具数量本身不再产生请求 token。模型只为它选择描述的单个工具支付 `mcp_describe` 的按需成本。

#### KV 缓存影响

注册表销毁/重建时桥接 schema 才变化；报告内容（服务器与工具列表）只出现在按需的工具结果中，不影响前缀。

## 已知限制与延期工作

- **点时快照** — `servers()` 反映读取时刻各上报者的状态；列清单期间变化的状态（例如某服务器在 `connected` 与 `reconnecting` 之间抖动）按服务器逐个拉取时各自报告，跨服务器没有事务。
