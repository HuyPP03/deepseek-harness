# dsh-credentials-oauth-tokens

[English](README.md) | 中文

基于文件的 OAuth 令牌包存储：一份 JSON 文档，一次只服务一个属主，自身不做过期处理。

文档是「属主 id → 令牌包」的严格 JSON 映射：

```json
{
  "notion": {
    "accessToken": "…",
    "expiresAt": 1754000000000,
    "tokenEndpoint": "https://api.notion.com/v1/oauth/token",
    "refreshToken": "…",
    "scope": "search:read page:read",
    "createdAt": 1753900000000,
    "updatedAt": 1753900000000
  }
}
```

属主 id 超出存储的 id 形状（`[a-z0-9][a-z0-9-]{0,31}`）、令牌包缺少非空 access token、`expiresAt` 非有限数值、缺少 `tokenEndpoint`、或可选字段为空字符串，一律拒绝而非跳过——一个被静默忽略的令牌包会被读成「我存的令牌没有生效」。偏差在启动时大声失败，在运行期热加载时保留最后好的快照并告警。

该存储是被动式的：绝不在定时器上刷新、过期或删除令牌包。属主——connector 认证流程——负责重新写入刷新后的令牌包或将其删除；消费方在每次使用时读取当前令牌包，因此轮换后的授权无需重启即可在下一次使用时生效。

## 服务

`ctx.oauthTokens`（`OAuthTokenStore`）：

| 操作 | 含义 |
|---|---|
| `get(ownerId)` | 从实时快照读取当前令牌包，或 `undefined`。 |
| `list()` | 已存储的属主 id，已排序。 |
| `put(ownerId, bundle)` | 持久化写入；保留 `createdAt`，刷新 `updatedAt`，发布 `oauth-tokens/updated`。 |
| `remove(ownerId)` | 持久化删除；属主不存在时为空操作。 |

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | `<harness home>/.connectors/oauth-tokens.json` | 令牌文档位置。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 省略 `path` 时使用的 harness home。 |
| `watch` | `true` | 热发布外部编辑。 |
| `debounceMs` | `100` | 监听器写稳定窗口。 |

## 存储纪律

纪律与 [`credentials-local`](../credentials-local/README.md) 一致：文档以 `0600` 写入仅属主可访问（`0700`）的目录之下；在 POSIX 上，任何带有组或其他权限位的文件会在读取内容之前被拒绝；每次写入在 [`dsh-atomic-write`](../../util/atomic-write/README.md) 的跨进程写锁下先重读文档，再只修改自己的属主——因此并发写入者或监听器去抖窗口内的外部编辑会被合并而非覆盖。

外部编辑会在快照**整体**替换后按属主发布 `oauth-tokens/updated`——磁盘上已删除的属主不会残留在内存中。存储自身的写入按内容识别，只发布其提交事件；内容未变化的重复提交不发布事件。

## 安全边界

文档以 `0600` 存于 `0700` 目录之下，能挡住其他操作系统用户——**挡不住**模型。工具进程以同一用户运行，可以像读取用户拥有的任何其他文件一样读取它；harness 绝不把文档的解析路径交给模型。这是谨慎而非边界——延迟的操作系统钥匙串方案见 [credentials-local 安全边界](../credentials-local/README.md#security-boundary)。

## 模型体验（Model Experience）

无，因为令牌包从不进入提示词、工具模式或工具结果，而消费方（connector MCP 服务器）在带外（out-of-band）向各自的提供方出示 access token。

#### KV Cache 影响

无。

## 已知限制与延迟工作

- **被动过期**——过期的令牌包在被属主刷新或删除之前始终可读；消费方在出示前必须检查 `expiresAt`。
- **同一属主的并发写入为后写获胜**——写锁与读-改-写保证并发写入者不会丢失彼此的属主，但两个写入者修改同一属主仍以后写为准；没有版本检查。
- **原子但非崩溃持久**——继承自 `dsh-atomic-write`；存储在启动时重读。
