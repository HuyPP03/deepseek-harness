# dsh-connectors-oauth-flow

[English](README.md) | 中文

连接器 OAuth 流程引擎（`ctx.oauthFlow`）：[dsh-connectors](../connectors/README.md) 连接器上 `oauth` 认证方式的宿主侧部分。`begin` 探测提供商的 MCP 端点，顺着它的 401 质询走到 RFC 9728 受保护资源元数据，再到 RFC 8414 授权服务器元数据，注册客户端（动态客户端注册，或 `byoApp` 方式下用户预注册的应用），启动 PKCE，并打开一个回环回调服务器。浏览器重定向回来后，引擎用授权码换取 token 包，存入以连接器 id 为属主的 [`dsh-credentials-oauth-tokens`](../../credentials/oauth-tokens/README.md) 存储——mcp-client 凭证接缝会把它作为该连接器服务器的 bearer 出示。`ensureFresh` 在挂载前刷新临近过期的包，因此只有当提供商的授权确实失效时才会要求重新授权。

## Config

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `port` | number | `8766` | 回环回调端口（仅 127.0.0.1）。 |
| `flowTimeoutMs` | number | `300000` | 一个流程等待浏览器重定向的时长，超时即放弃。 |

## Lifecycle

`begin(id)` 对每个连接器幂等：一个流程进行中时再次 begin 会抛错。流程恰好结算一次——浏览器成功（token 包已存、连接器已挂载）、提供商报错、state 不匹配、换码被拒、流程超时或取消——并且 `authorizing` 标记与回环监听器在同一步清除。在流程已结算之后到达的失败会作为该连接器的 `lastError` 记录（状态 `error`）。

## Model Experience

无，因为引擎是宿主侧的认证驱动器，不注册任何 prompt、schema 或结果；它启用的已连接服务器是 mcp-client 拥有的普通 MCP 工具。

#### KV Cache effect

没有面向模型的内容进入任何请求；它拥有的唯一状态是存储的 token 包，而连接器行从 `authorizing` → `connected` 的转换将其排除在 prompt 之外。

## Known Limitations and Deferred Work

- 引擎在每次 `begin` 时重新运行发现与客户端注册；DCR 客户端不会跨流程缓存，因此对注册量有限制的提供商可能拒绝反复授权。`byoApp` 客户端从 override 文档与凭证接缝读取，保持稳定。
- 回环端口每进程单实例：两个连接器的两个流程共用同一端口，无法绑定端口的流程会响亮失败，而不是自选空闲端口。
- 客户端表面在新标签页打开返回的授权 URL，并在某行处于 `authorizing` 时轮询列表；无浏览器的宿主（headless）仍能完成流程，但没有任何东西自动打开该 URL。
- 设备码认证（Microsoft 365）不属于本引擎的流程：其 P4 将通过连接器自身工具落地服务器驱动的换码。
