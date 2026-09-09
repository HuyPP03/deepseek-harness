# Agent Note: connectors —— 自托管服务的按用户实例 URL

Status: implemented

[English](2026-09-08-connectors-self-hosted-instance-url.md) | 中文

## Problem

自托管服务（Confluence Data Center / Server）用按用户的个人访问令牌 *加* 按用户的 base URL 认证——同一部署的两个用户指向不同的实例。连接器 override 机制（`{ $override: url }` 服务器槽位从用户 override 文档解析）本来就支持 URL，但没有任何界面把它暴露出来：客户端的 token 对话框只提供凭据字段，所以需要 URL 的连接器只能手改 override JSON 才能配置；只存 token 会让行停留在不透明的 `error` 状态，且没有回到表单的路径。

## Decision

Confluence 作为目录清单发布，URL 成为其自身配置流程的一等字段：

- `apps/cli/config/connectors/confluence.yml`：stdio `uvx mcp-atlassian`，env 为 `CONFLUENCE_URL: { $override: url }` 加 `CONFLUENCE_PERSONAL_TOKEN: { $cred: CONFLUENCE_PERSONAL_TOKEN }`，复用已发布的 `custom` 预设。它作为目录清单而非自定义连接器发布，因为 `addCustom` 的 env 与 headers 只能是字面量，无法携带 `$override` 槽。
- `ConnectorView` 增加 `urlRequired`（清单从 override 文档解析 base URL）与 `url`（存好后的值）；apiproxy 的 wire schema 两者都透传。
- 状态关卡收紧：对需要 URL 的清单，“已配置”——`unconfigured` 与 `needs-auth` 之间的关卡——额外要求 `url` override 已存储。只存 token 会让行留在 `Configure`。
- 因缺少 override 的挂载失败是配置前置条件，不是操作失败：`configure` 的自动挂载 catch 不为 `ConnectorOverrideMissingError` 记录 `lastError`，行停留在其 configure 关卡，而不是落入 `error`。
- `urlRequired` 行的 token 对话框显示 “Instance URL” 字段，用已存的 `url` 预填，Save 要求它与凭据一并填写；`configure` 以 `fields.url` 发送。token 已存但 URL 未存时，`canConfigure` 也提供 `Configure`。

## Alternatives considered

**New-connector 对话框上的通用 env 字段（第一次尝试）。** 它到达了用户，但把字面量 URL 烤进了一份手写清单——URL 从此属于某一个用户的部署，无法按用户重新解析，也不是 Confluence 自身的流程。用户明确要求 URL 放在 Confluence 自己的 Configure 步骤上，正是因为其他用户的实例不同。

**保留缺失 override 的 `error` 状态，让用户重试 `Connect`。** 错误消息会点名该字段，但卡片不提供表单：用户什么都不用重填却得到同样的失败，或者去改 JSON。configure 关卡通过对话框到达同一个地方。

**给 `connect` 加一个 `url` 参数。** override 文档已经是非密文按用户字段的持久化存储，且 `configure` 已经接受它；第二条写入路径需要自己的持久化、事件与 disconnect 清理故事。

## Testing

- `dsh-connectors`：干净启动上的 URL 关卡（只存 token → `unconfigured`；存 URL → 视图带 `url` 的 `needs-auth`），以及扩展的 override 解析流程。
- `dsh-apiproxy`：wire 测试现在断言关卡而不是 error 状态——响应视图携带 `urlRequired`/`url`，connect 仍以 `connector-override-missing` 拒绝，存 URL 的 configure 把状态推到 `needs-auth`。
- `dsh-client-ui-connectors`：controller（URL 草稿从已存值预填、非 URL 行与已关闭对话框的 `setDialogUrl` 守卫、保存发送 `fields.url`）、directory（token 已存但 URL 未存的卡片提供 `Configure`、URL 已存的卡片提供 `Connect`；对话框渲染 URL 字段并在两者都填好前保持 Save 关闭）、以及 inject 面。
- `shipped-connectors.spec`：roster 包含 `confluence`，其视图声明 `urlRequired`。

## Consequences

- Confluence 的流程是 Configure（实例 URL + 个人访问令牌）→ Connect；URL 存于用户 override 文档，`disconnect` 会与其它一切一起清除它。
- 未来任何自托管目录连接器沿用同一模式：一个 `{ $override: url }` 槽加 token 对话框的 URL 字段——无需为每个服务新增 UI 面。
- 工作树中的已发布 roster 是 Confluence、Figma、GitHub、Notion、Slack（atlas、Google 与 Microsoft 365 清单被用户本地隐藏；roster 规格匹配工作树，它们恢复时必须重新更新）。

## Related

- [connectors multi-reference token dialog](2026-08-23-connectors-multi-ref-token-dialog.md) 拥有本 note 用 URL 字段扩展的按凭据引用对话框。
- [connectors split surface list and directory](2026-08-24-connectors-split-surface-list-and-directory.md) 拥有卡片动作所在的 directory 面。
