# dsh-connectors-device-flow

[English](README.md) | 中文

连接器设备码流程引擎（`ctx.deviceFlow`）：[dsh-connectors](../connectors/README.md) 连接器上 `device` 认证方式的宿主侧部分。`begin` 驱动连接器已挂载 MCP 服务器上的登录工具；当提供商返回设备码指示（一个 URL 和一个一次性代码）时，引擎在后台轮询验证工具，直到登录结算或窗口关闭。报告账户已登录的提供商无需代码即结算。引擎从不存储凭证：MCP 服务器拥有自己的 token 缓存。

## Config

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `flowTimeoutMs` | number | `900000` | 一个流程等待登录结算的时长，超时即失败并卸载服务器。 |
| `pollIntervalMs` | number | `5000` | 验证工具的轮询周期。 |

## Lifecycle

`begin(id)` 对每个连接器幂等：一个流程进行中时再次 begin 会抛错。连接器服务先挂载服务器，再把挂载交给引擎；引擎调用登录工具、解析提供商的指示、并在后台轮询验证工具。流程恰好结算一次——验证成功（连接器结算为 `connected`，服务器保持挂载）、验证报错（记录失败、卸载服务器）、窗口超时（记录失败、卸载服务器）或取消（无错误、卸载服务器）——并且 `authorizing` 标记在同一步清除。

## Model Experience

无，因为引擎是宿主侧的认证驱动器，不注册任何 prompt、schema 或结果；它启用的已连接服务器是 mcp-client 拥有的普通 MCP 工具。

#### KV Cache effect

没有面向模型的内容进入任何请求；它拥有的唯一状态是进行中的流程窗口，而连接器行从 `authorizing` → `connected` 的转换将其排除在 prompt 之外。

## Known Limitations and Deferred Work

- 登录与验证工具名来自清单的 `loginTool` 与 `verifyTool` 字段；提供商重命名工具需要修改清单。
- 设备码解析期望提供商的消息携带登录 URL 和代码；返回不同指示格式的提供商会响亮失败，而不是猜测。
- 验证轮询是固定周期；轮询间隔更长的提供商会浪费调用，但当提供商的缓存热起来时登录仍会结算。
