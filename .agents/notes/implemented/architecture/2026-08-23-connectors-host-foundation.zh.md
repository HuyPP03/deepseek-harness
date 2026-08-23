# Agent Note: Connectors — predefined external connections as a state machine over MCP servers

Status: implemented

[English](2026-08-23-connectors-host-foundation.md) | 中文

## Problem

预定义外部连接（Notion、GitHub、Atlassian、Slack、Google、Microsoft 365）在聊天界面 UI 和 API 动词存在之前，需要宿主侧的身份。没有它，每个外部 MCP 服务器只是一次手动 mcp-client 挂载：密钥以字面量形式留在 `.mcp` 文档里，没有任何东西记录哪个服务器属于哪个产品概念，也没有按连接器的状态区分"未配置"和"已配置但授权失败"。

## Decision

`connectors/` 包组以两个包提供宿主侧基础：

- `@deepseek-ai/dsh-connectors`（`packages/connectors/connectors`）—— 注册为 `ctx.connectors` 的 `Connectors` 服务：YAML 目录（内置 `catalogDir` + 位于 harness home 下的用户 `userDir`）、按连接器的配置文档与覆盖文档、以及在这些 id 之上的状态机。
- `@deepseek-ai/dsh-credentials-oauth-tokens`（`packages/credentials/oauth-tokens`）—— 位于 `<harness home>/.connectors/oauth-tokens.json` 的文件化 OAuth 令牌包存储。

状态机是产品词汇：`unconfigured | needs-auth | authorizing | connecting | connected | reconnecting | down | error`。状态从其他服务已知的信息推导 —— mcp-manager 的注册表（已挂载）、配置文档、内存中的 `lastError` —— 并且 `connector/state` 只在状态跃迁时触发。

所有权仍归既有服务：mcp-manager/mcp-client 负责挂载与实时状态，credentials-local 负责密钥，oauth-tokens 负责令牌包，agent-presets 负责 preset 的复制/删除。`Connectors` 只拥有目录、文档、状态推导与事件。挂载失败（`McpServerExistsError`）变成 `lastError` 加 `error` 状态，而不是抛出的操作；没有已存密钥的凭据槽在最早可解析点抛出 `ConnectorCredentialMissingError`。

临时决定，在后续阶段落地前记录于包 README：

- 密钥内联进生成的 `.mcp` 文档。mcp-client 的 `{$cred}` 占位接缝（含 oauth-tokens 派生的 bearer）在 P1 到达。
- `connect()` 对 `oauth` 与 `device` 方式抛出 `ConnectorAuthUnavailableError`；`setAuthorizing` 是 P3 oauth-flow 引擎的接缝。
- 无授权的自定义连接器在 `addCustom` 时自动挂载；`lastError` 仅存于内存；覆盖文档是启动时快照。
- 令牌存储是被动的（无定时器），并镜像 credentials-local 的存储纪律：`0700` 目录下的 `0600` 文件、跨进程写锁、chokidar 热发布、整体快照替换。

机械固定项：`tsconfig.base.json` 为两个新包增加显式 `paths` 条目，外加 `./packages/connectors/*/src` 通配组。connectors 的测试 `vi.mock` MCP SDK 时不声明它，而是通过 mcp-client 自身的依赖解析 —— 在那里多一个开发依赖只会触发 knip，并不会改变 mock 身份。

网络面位于 `packages/host/apiproxy`：七个 `connector.*` 一元方法（`list`、`configure`、`connect`、`complete`、`disconnect`、`add`、`remove`）架在服务之上。`list` 在结构上不含密钥，部署未组合 connectors 服务时以空花名册应答；同样的情况下变更动词报告 `connector-unavailable`。服务的具名拒绝收窄为稳定代码（`connector-not-found`、`connector-exists`、`connector-not-custom`、`connector-credential-missing`、`connector-override-missing`、`connector-auth-unavailable`），普通拒绝与接缝缺失报告则落到 `internal` 与 `connector-unavailable`。`complete` 是授权流的存值-连接半步：在 P3 流引擎落地前，它与带 `{ token }` 的 `configure` 是同一操作。变更动词在提交之后重读视图并返回，客户端更新一行而无需整表往返。浏览器载体把六个变更动词钉在回环同源请求上——`host.pickDirectory` 特权集合——因为 `configure`/`complete` 携带凭据值、`add`/`remove` 写入可能持有密钥的清单，而 `list` 保持普通：其行不含密钥，聊天面需要花名册。

应用组合在 base bundle 层挂载该服务，并把内置目录根作为补丁注入：`apps/cli` 的 profile 启动把 `config/connectors/`（六个清单 —— `notion`、`github`、`google`、`slack`、`atlas`、`m365`）解析为 `catalogDir` 覆盖，可写的 `userDir` 保持服务自身的 harness-home 默认。`apps/cli/tests/shipped-connectors.spec.ts` 在操作系统分配端口上钉住一次真实 profile 启动，因为一份损坏的清单会在启动时让整个 profile 失败。

## Alternatives considered

**给 mcp-manager 扩展按连接器的状态。** 被拒绝：mcp-manager 的契约是名称唯一注册表加生命周期；needs-auth/authorizing/error 语义是产品关注点，会泄漏进通用机制。

**把令牌包放进 credentials-local。** 被拒绝：令牌包有不同的不变量（按 owner 索引、`expiresAt`/`tokenEndpoint` 字段、刷新语义）和不同的事件（`oauth-tokens/updated`）；独立存储让两个 schema 都保持严格。

**把连接器密钥存进按连接器的文档。** 被拒绝：credentials-local 是唯一权威密钥存储；第二套存储会分裂信任模型。

**每次状态评估都发事件。** 被拒绝：只在跃迁时发事件，使重连抖动期间日志保持安静；需要新值的消费者调用 `list()`。

## Consequences

产品现在拥有外部连接身份（id、状态、lastError、文档）、驱动它的 API 动词（`connector.*`）、以及 CLI 启动的内置目录 —— 无需活的 MCP 服务器即可测试，聊天屏幕（P0b）是剩下的消费者。代价：P1 之前持久化的 `.mcp` 文档里有字面量，`lastError` 在重启时丢失，覆盖文档只在启动时重载。两个包均达到 100% 按文件覆盖率，watcher 与 drain 规格镜像 credentials-local 的模式（伪造 chokidar、门控原子写）。

## Related

- [MCP client auto-reconnect](../feature/2026-08-06-mcp-client-auto-reconnect.md) —— `reconnecting`/`down` 背后的重连策略。
- [Provider credential lifecycle](../bug-fix/2026-08-06-provider-credential-lifecycle.md) —— 令牌存储所镜像的密钥存储纪律。

按顺序延迟：P0b ui-sidebar store + `client/ui-connectors`、P1 mcp-client 的 `{$cred}`、P3 oauth-flow 引擎、P4 device-code、P5 自定义连接器 UI。
