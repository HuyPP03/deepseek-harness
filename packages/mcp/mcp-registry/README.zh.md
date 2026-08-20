# @deepseek-ai/dsh-mcp-registry

[English](README.md) | 中文

一个 app 内所有存活 [`mcp-client`](../mcp-client/README.md) 实例的共享注册表：每个客户端报告其服务器的连接状态与已注册工具，[`/mcp`](../command-mcp/README.md) 读取快照。注册表只是读取面——它不拥有连接、工具或任何生命周期。

## 服务 API

| 方法 | 返回 |
|---|---|
| `report(serverName, read)` | 移除该上报者的 disposer；重复的存活 `serverName` 会抛错 |
| `servers()` | 所有上报者的当前视图，按 `serverName` 排序 |

上报者持有一个**读取闭包**，按需计算当前的 `McpServerView`：

```ts
interface McpServerView {
  serverName: string
  status: 'connecting' | 'connected' | 'reconnecting' | 'down'
  tools: readonly { name: string; description: string }[]
}
```

拉取语义是有意为之。mcp-client 的 supervisor 在每次重连状态变化时都会修改其内部状态；若在每次转换时推送，会把两个包耦合到 supervisor 的事件顺序上。改为 `servers()` 在读取时拉取每个读取闭包，因此重同步期间的读取永远不会看到部分 generation，而上报者在 disposed 后返回空值时，该服务器只是不在快照中。

## 组合

基础 bundle 挂载注册表，使任意 preset 中的每个 `mcp-client` 实例都报告到同一个注册表。`mcp-client` 通过可选的 `ctx.get('mcpRegistry')` 读取注册表——未挂载时桥接行为不变，只是无处报告：

```yaml
- id: mcp-registry
  name: '@deepseek-ai/dsh-mcp-registry'
```

由于注册表是 app 级的，preset 中的 `/mcp` 只看到该 preset app 连接的服务器；它是本部署的状态视图，而非所有可连接服务器的目录。

## 模型体验

### 无

#### 模型看到什么

无。`ctx.mcpRegistry` 及其消费者（mcp-client 上报者、`/mcp` 命令）都在宿主侧：没有任何 prompt、工具 schema 或会话事件引用该注册表。

#### Token 影响

零——注册表不产生任何模型 token。

#### KV 缓存影响

无——注册表不触及面向模型的 prefix。

## 已知限制与延期工作

- **点时快照** — `servers()` 反映读取时刻各上报者的状态；列清单期间变化的状态（例如某服务器在 `connected` 与 `reconnecting` 之间抖动）按服务器逐个拉取时各自报告，跨服务器没有事务。
