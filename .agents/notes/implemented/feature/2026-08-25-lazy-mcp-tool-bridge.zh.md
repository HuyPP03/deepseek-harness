# Agent Note: MCP 工具懒加载桥接——unlisted 工具与 mcp-registry 桥接

Status: implemented

[English](2026-08-25-lazy-mcp-tool-bridge.md) | 中文

## Problem

[mcp-client 插件](2026-07-07-mcp-client-plugin.md) 把每个已发现的 MCP 工具注册为模型可见的原生工具，完整 JSON Schema 进入请求的 `tools` 数组。一个已连接的服务器就可能通告庞大的工具面：一个真实的 Microsoft 365 部署通告了 188 个工具，schema 合计约 1 MB（约 254K token），在任何一个对话 token 之前就把每次请求推过了本地 provider 的 262144 token 窗口——一条消息的全新会话直接以 `CONTEXT_WINDOW_EXCEEDED` 失败。每个已连接的服务器都让请求成本随其工具数量增长，与对话实际用到哪些工具无关。

## Decision

MCP 工具 schema 默认对模型不可见；模型通过三个小的固定工具按需发现并调用它们。

### `unlisted` ToolDefinition 标志（`dsh-tools`）

`ToolDefinition` 新增可选的 `unlisted: boolean`。unlisted 定义保持注册、可被 `get()` 解析、可被 `execute()` 调度（prompt 顺序校验经 `knownNames` 保留其名称），但排除在所有面向模型的投影之外：`schemas()`、`sdkSchemas()` 以及 `wireSchemas()` 的两个分支（native 与 Code Mode）都经同一 `modelListed()` 通道过滤。该标志是注册属性而非作用域：定义注册到哪里，它就在哪里生效。

### 每服务器工具以 unlisted 注册（`mcp-client`）

mcp-client 的 `createDefinition` 现在为每个工具定义输出 `unlisted: true`。其余一切——公开名称推导、重新同步世代、executor、图片投影、规范 MCP 结果——不变；该工具只是不再出现在模型的 `tools` 数组中。

### 模型桥接（`mcp-registry`）

注册表——已挂载在 base bundle、已是存活服务器目录的属主——在每个 app 中一次性注册三个 listed 工具，每个都挂在 `ctx.effect` 上，销毁注册表即移除：

- `mcp_list` — 所有已连接服务器及其工具的公开名称与一行描述；可选 `server` 过滤；未知服务器名是列出已连接服务器的错误。
- `mcp_describe` — 按公开名称返回一个工具的描述与完整输入 schema；未知或非 MCP 名称是错误。
- `mcp_call` — 按公开名称调度一个工具，参数须匹配所描述的 schema，返回工具结果内容。

`mcp_call` 通过 ToolRuntime 以确切的公开名称调度，并转发调用方的 `agent`、嵌套 `parent` token 与 signal——因此会话日志记录与直接工具调用相同的 `mcp__<serverName>__<rawName>` 调用、参数与结果，Code Mode 合法性得以保持（桥接调用是普通的 listed 工具；内部调度是带 `parent` 的嵌套调用），mcp-client 自身的 executor、输出校验、图片投影与失败语义全部照常运行。target 面只接纳携带 `mcp__` 前缀的已注册 `unlisted` 定义，因此桥接够不到原生工具或冒名名称；内部失败表现为桥接调用自身的错误，内部成功但缺少 MCP 结果词汇的被拒绝。

模型的流程是 list → describe → call：名称与一行描述每个工具至多花费几个 token（且只对模型询问的服务器），完整 schema 只在真正需要时按工具支付一次，没有任何工具 schema 占据请求前缀。

## Alternatives considered

- **限制每服务器工具数量** — 任意且无声：模型对未纳入的工具失去访问且无信号，上限还乘以服务器数量。拒绝。
- **单个不透明 `mcp` 工具接收自由格式命令** — 只有一个 schema，但模型失去逐工具的名称、描述与 schema 校验参数；会话日志不再指名确切工具；权限与遥测形状（`mcp__*`）失效。拒绝。
- **持有 schema 的 MCP 子代理** — 把成本移到第二段模型对话而非删除它，每次工具使用增加一跳委托，并拆分权限面。拒绝。
- **仅 prompt 发现（在 system prompt 中注记工具名）** — 名称会进入前缀，模型没有类型化途径按需取回单个 schema，且注记与重新同步脱节。三个工具经由现有调度流水线完成同样的工作。拒绝。
- **保持 schema 可见、让用户自行断开臃肿服务器** — 事故恰恰来自一个合法连接的服务器；修复不能依赖用户回避有用的服务器。拒绝。

## Consequences

- 已连接服务器的工具数量不再放大请求 token；固定成本是三个桥接 schema，重新同步 unlisted 世代不会使模型前缀失效。
- 使用一个 MCP 工具在调用前多花两轮（list、describe）。接受：describe 每工具每对话只支付一次，list 可按请求收窄到单个服务器。
- `unlisted` 接缝是通用的——任何插件都能注册仅可调度的工具——但 MCP 桥接是目前唯一消费者。
- [mcp-client 插件 note](2026-07-07-mcp-client-plugin.md) 的命名、身份与 wire 决定不变：同样的公开名称、同样的 wire 原始名称、同样的会话日志条目。
- 从不发现（从不调用 `mcp_list`）的模型看不到 MCP 工具——连接在 `/mcp` 与 UI 中存在，但在对话中不活跃。这是有界请求成本的预期代价。
