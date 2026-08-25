# dsh-connectors

[English](README.md) | 中文

连接器目录与状态机：预定义连接（Notion、GitHub、Atlassian、Slack、Google、Microsoft 365 等）与用户自定义连接器，每个都通过 [`dsh-mcp-manager`](../../mcp/mcp-manager/README.md) 挂载一个或多个 MCP 服务器。

一个连接器是一份清单：它要挂载的 MCP 服务器、如何为它们认证，以及带它的会话要组合的 agent 预设。状态**在读取时派生**，来源是权威 seam——凭据存储、OAuth 令牌存储、实时 MCP 注册表——因此连接器不可能声称 seam 没有显示的状态。

## 清单

预定义清单是配置目录下的 YAML 文件；自定义连接器以 JSON 持久化在用户目录。

```yaml
id: notion
name: Notion
description: Read and write Notion.
presetId: notion
workspaceDirName: notion
auth:
  - mode: token
    credentialRefs: [NOTION_API_TOKEN]
    howTo: Create an internal integration.
servers:
  - serverName: notion
    transport: stdio
    command: npx
    args: ['-y', '@notionhq/notion-mcp-server']
    env:
      NOTION_API_KEY: { $cred: NOTION_API_TOKEN }
suggestions:
  - Summarize my workspace
```

- `auth` 列出 `token`（一个或多个凭据引用）、`oauth`（服务器 URL，可选自带应用的 client）或 `device`（登录/校验工具名）方法。空列表表示服务器无需认证。
- 服务器 `env`/`headers` 的值可以是字面量或占位符 `{ $cred: REF }` 与 `{ $override: FIELD }`。`$cred` 引用透传到挂载服务器的文档，mcp-client 在每次连接尝试时从凭据存储解析（对 OAuth 连接器的 bearer 标头，则从 token 存储解析为 `Bearer <accessToken>`）；`$override` 引用在挂载时从连接器的用户 override 文档（`url`、`clientId`、`products`、`orgMode`、`readOnly`）解析。在 YAML 中，占位符要写成映射——`{ $cred: REF }`——而不是带引号的字符串。
- 每份清单都严格解析；无效清单会让 boot 失败，而不是被跳过。

## 服务

`ctx.connectors`（`Connectors`）：

| 操作 | 含义 |
|---|---|
| `list()` | 所有目录 + 自定义连接器，以 wire 安全视图返回，按 id 排序。 |
| `get(id)` | 一个视图，或 `undefined`。 |
| `manifest(id)` | 原始清单（host 内部用；视图永不携带命令、env 或 URL）。 |
| `setAuthorizing(id, inFlight)` | 标记进行中的认证流程；标记期间状态读作 `authorizing`。 |
| `configure(id, fields)` | 存储 token/凭据值与/或 override 字段。token 方法配置完整时自动连接；挂载失败会记录 `lastError`，而不是丢掉已存值。 |
| `connect(id, mode)` | 以 token 挂载；每个已声明的凭据引用必须先已存储（否则抛 `ConnectorCredentialMissingError`）。`oauth` 与 `device` 在流程引擎落地前以 `ConnectorAuthUnavailableError` 拒绝。 |
| `disconnect(id)` | 卸载、清除连接器的凭据、删除其令牌包，并删除其 override 文档。 |
| `addCustom(spec)` | 创建 `custom-<slug>`：复制 `custom` 预设、持久化清单、无认证需求时自动挂载。 |
| `removeCustom(id)` | 卸载、清除凭据、删除清单与预设副本。拒绝删除预定义 id。 |

wire 视图按构造就是无密文的：服务器条目携带 `serverName`、`mounted`、`status`；认证条目携带 `mode`、`configured`、token 方法的 `credentialRefs`（公共引用名——客户端 token 对话框的按引用字段）与面向用户的提示——从不携带值。

### 状态

`unconfigured` → `needs-auth` →（`authorizing`）→ `connecting` → `connected` → `reconnecting`/`down`，另加 `error`（在一次失败操作的 `lastError` 挂起期间）。派生规则：已挂载服务器的状态来自注册表；挂起的挂载失败优先于连接器并不拥有的同名注册表视图（被占用的名字显示 `error`，而不是占用者的状态）。

### 事件

`connector/state(connectorId, state)`——仅当连接器操作或认证流程转换改变了派生状态时发出。没有连接器操作的注册表状态翻转不会发出事件；界面轮询 `list()`。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `catalogDir` | 无 | 预定义 `.yml` 清单目录；缺省时目录只有自定义连接器。 |
| `userDir` | `<harness home>/.connectors` | 自定义清单（`.json`，按 id 匹配）与 override 文档。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | `userDir` 默认值所用的 harness home。 |

可选 seam：`credentials`、`oauthTokens`、`agentPresets` 通过 `ctx.get` 消费；需要某个缺失 seam 的操作以 `ConnectorSeamUnavailableError` 失败，而读取在没有它们时仍可用。

## 临时行为（在认证流程引擎落地前）

- `$cred` 解析在 mcp-client：持久化的 `.mcp` 文档保留引用，每次连接尝试从凭据存储或 OAuth token 存储解析，因此新存或刷新后的值在下次尝试即生效。`$override` 仍在挂载时解析（用户 override 文档的 boot 时快照）。
- OAuth 与 device 流程在本阶段没有引擎：`connect(id, 'oauth'|'device')` 以具名错误拒绝；byoApp OAuth 方法在存好 client id + secret 后即为“已配置”（状态 `needs-auth`）。

## Model Experience

无，因为已连接连接器的工具是其 `mcp__<server>__<tool>` 名字下的普通 MCP 工具，目录与状态从不进入提示，`configure`/`connect`/`disconnect` 是 host 操作而非模型工具。

#### KV Cache 影响

无。

## 已知限制与延迟工作

- **启动时的凭据失败表现为服务器 down**——文档引用未配置凭据的已挂载服务器会在 mcp-client 连接尝试中失败（重连退避，状态 `down`）；产品层守卫（`connect` 预检）在挂载前大声失败，因此这只影响凭据被从下抽掉的服务器。
- **没有 device-code 引擎**——M365 的 device-code 循环将在后续阶段落地；目前只组合了浏览器 OAuth 流程（[dsh-connectors-oauth-flow](../oauth-flow/README.md)）。
- **被动状态靠轮询**——没有连接器操作的注册表翻转（服务器掉线、重连）在下次 `list()` 时可见；不为它们发出事件。
- **override 是 boot 时快照**——override 文档的外部编辑不会热重载。
- **`lastError` 在内存中**——失败挂载的报错在下一次成功操作前保留，但不跨重启。
