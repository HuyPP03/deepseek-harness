# Agent Note: Connectors P1 — 由 mcp-client 解析凭据引用，与随附的 preset 名册

Status: implemented

[English](2026-08-23-connectors-cred-refs-and-presets.md) | 中文

## 问题

P0a 在挂载时把连接器的 `{$cred}` 槽位解析为字面量，并把该字面量持久化进 `.mcp` 服务器文档：每个已挂载的服务器都在磁盘上携带自己的机密，凭据轮换需要重连，且持久化文档无法在不暴露值的情况下被共享或审计。连接器清单中的 `presetId` 字段指向并不存在的 preset，因此连接器会话没有可供启动的组合。

## 决策

**解析移入 mcp-client，按连接尝试进行。** 服务器的 `env`/`headers` 值现在是 `string | { $cred: REF }`（`ServerValue`），由 mcp-client 配置 schema 接受。每次尝试启动传输之前，`resolveServerValues` 解析每个引用：该引用的已存 `credentials` 值优先；否则引用对应的 `oauthTokens` 束以 `Bearer <accessToken>` 呈现；否则该尝试以具名错误失败，并指出服务器与引用。两个服务都通过 `ctx.get` 消费——即可选服务模式——纯字面量配置从不触碰它们。由于解析按尝试而非按挂载进行，新存或刷新后的值在下次尝试（包括 supervisor 重连）即生效，无需重启。

**持久化文档保留引用。** mcp-manager 原样持久化所给 spec，引用透传不变；connectors 服务的 `toManagerSpec` 现在只解析 `$override` 槽位（用户 override 文档的 boot 时快照），并在校验 token 方法的槽位只引用该方法已声明的引用之后，把 `$cred` 槽位作为引用转发（引用未声明 ref 的槽位以 `ConnectorCredentialMissingError` 使挂载失败）。`connect(id, 'token')` 在挂载前通过 `requireTokenRefsStored` 预检每个已声明引用，因此缺失凭据在最早点以产品错误失败；boot 时引用未设置的挂载则表现为 mcp-client 连接失败（重连退避，状态 `down`）——对凭据被从已挂载服务器下抽走的情形，这是 P1 可接受的语义。

**七个随附 preset。** `apps/cli/config/agent-presets/` 新增 `notion`、`github`、`google`、`slack`、`atlas`、`m365` 与 `custom`，每个为 `preset.yml` + `agent.cordis.yml`，基于 `chat` 组合（host 平面 MCP 工具之上的无工作目录助手）并带 connector 专属 persona。`custom` 是 `agentPresets.copy('custom', ...)` 在添加自定义连接器时复制到新 preset id 的模板。一个真实组合 e2e（`apps/cli/tests/web-agent-presets.e2e.ts`）现在断言完整的 12 个 preset 名册，并经由启动的 Web 组合组成每个 connector preset，断言其文件声明的 persona 与 chat 式工具层。

## 考虑过的替代方案

**在 connectors 服务中解析 `{$cred}`，只为它自己的服务器保留引用。** 被拒：直接（非连接器）mcp-manager 服务器与手写的 `.mcp` 文档仍会内联机密，而且两个解析点（connectors 在挂载时、直接服务器没有）比一个更宽。

**挂载时解析并把值缓存在连接世代中。** 被拒：mcp-client supervisor 每次尝试都重启原始配置；按尝试重读存储是同样的开销（两次存储查找），也正是让轮换或刷新后的凭据免费到达下次尝试的原因。

**给 connector preset 各自独立的工具组合。** 被拒：连接器的 MCP 服务器按 host 全局挂载，每个 preset 已经能看到它们；带 connector persona 的无工作目录助手是最小正确会话面，`custom` 也保持单一模板。

## 后果

- 连接器写入的 `.mcp` 服务器文档现在在 P0a 携带字面量的位置携带 `{$cred: REF}`；携带内联机密的老文档只是一个字面量配置（schema 两者都接受），因此无需迁移。
- `{$cred}` 引用在每次连接尝试时重新解析：引用未设置的 boot 时挂载进入重连循环（状态 `down`）失败，而非使产品操作失败，因此 `connect` 的预检是用户可见情形的响亮路径。
- web preset e2e 自 P0b 添加 `client/ui-connectors` 而未构建其 client bundle 以来一直是红的：启动的 Web 组合从 `lib/` 加载该插件。bundle 已在树内构建，e2e 断言新 preset，因此未来跳过构建的 client 插件添加会在那里失败。
- mcp-client 现在把 `dsh-credentials` 与 `dsh-credentials-oauth-tokens` 列为 peer + dev 依赖（connectors 的模式）。

## 相关

- [Connectors — the host foundation](2026-08-23-connectors-host-foundation.md) — 本 note 所替换其 `{$cred}` 临时行为的状态机。
- [Connectors — the chat-screen region](2026-08-23-connectors-chat-region.md) — P0b 落地的客户端面；本 note 的延迟 P1 行是它的上半（`{$cred}` 缝隙与 preset 名册）。

延迟，按顺序：P2 Slack/Atlassian 尖峰，P3 带真实 `connector.complete` 的 oauth-flow 引擎，P4 M365 device-code 流程，P5 自定义连接器 UI。
