# @deepseek-ai/dsh-mcp-manager

[English](README.md) | 中文

用户 MCP 服务器管理器：负责用户在运行时添加的 MCP 服务器。每个用户服务器持久化为 harness home 下 `.mcp/` 目录（默认 `$DSH_HOME/.mcp`）中的一个 `<serverName>.cordis.yml` 文件，并在启动和 `add` 时挂载为 [`dsh-mcp-client`](../mcp-client/) 的实时实例。profile 或宿主组合中声明的服务器不是用户服务器——管理器绝不触碰它们，但所有服务器（两种来源）都会上报到共享的 [`dsh-mcp-registry`](../mcp-registry/)，管理器的 `servers`/`reconnect` 接口直接读取该并集。

## 用法

挂载在基础组合中（`packages/bundle/base/cordis.patch.yml`）：

```yaml
- id: mcp-manager
  name: '@deepseek-ai/dsh-mcp-manager'
```

### 持久化服务器文档

每个用户服务器一个文件，包含单个 `mcp-client` 条目：

```yaml
# $DSH_HOME/.mcp/websift.cordis.yml
- id: mcp-client-websift
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: websift
    transport: streamable-http
    url: http://192.168.161.79:8787/mcp
```

文档以 `0600` 写入（headers 和 env 可能包含机密）；目录为 `0700`。`env`/`headers` 的值可以是字面量或 `{$cred: REF}` 凭据引用；文档原样保留 spec 携带的内容，mcp-client 在连接时解析引用。无法解析的文档会在启动时大声失败，与其他组合输入一致；挂载失败的 `add` 会删除刚写入的文档。

### 服务 API

| 方法 | 返回 / 抛出 |
|---|---|
| `servers(): readonly McpServerView[]` | 所有已上报的服务器（profile + 用户），按 `serverName` 排序 |
| `userServers(): readonly string[]` | 管理器从其目录挂载的排序后的 serverName 列表 |
| `add(spec: McpServerSpec): Promise<void>` | 持久化并挂载一个服务器；`serverName` 被占用（任意来源）或挂载失败时拒绝，并回滚文档 |
| `remove(serverName: string): Promise<void>` | 卸载实例并删除其文档；服务器非用户管理时拒绝 |
| `reconnect(serverName: string): Promise<void>` | 任意已上报服务器（任意来源）的手动重连；未上报时拒绝 |

宿主 RPC 层（API 代理上的 `mcp.list` / `mcp.add` / `mcp.remove` / `mcp.reconnect`）封装了这些方法；管理器依赖的手动重连连接监督器见 [mcp-client](../mcp-client/) README。

## 配置

| 字段 | 必填 | 说明 |
|---|---|---|
| `mcpDir` | 否 | 存放每个用户服务器 cordis.yml 的目录；默认 harness home（`$DSH_HOME` / `~/.dsh`）下的 `.mcp` |

## Model Experience

间接的，通过它挂载和卸载的 `mcp-client` 实例：它们发现的工具随之出现和消失，其 token 与 KV-cache 成本归服务于它们的 client 所有。

#### KV Cache effect

`add` 与 `remove` 是用户发起的宿主操作，不产生会话事件，因此名册变化只对之后组建的会话可见，而不是正在运行的对话。

## 已知限制与延迟工作

- 管理器服务于单个进程；共享同一 `$DSH_HOME` 的并发应用可能同时编辑 `.mcp/`（每个文件最后写入者获胜，无锁）。
- `add` 同步挂载实例：无法连接的服务器仍会被添加，并进入 mcp-client 重连循环（可通过 `servers()` 观察）。
