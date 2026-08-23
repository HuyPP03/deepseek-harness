# Agent Note: Connectors P2 — Slack/Atlassian 尖峰与按引用的 token 对话框

Status: implemented

[English](2026-08-23-connectors-multi-ref-token-dialog.md) | 中文

## 问题

P1 的 token 对话框只录入一个机密，并存到 token 方法的第一个凭据引用下。对两个最难随附集成的一次性实时探测表明这不够：Slack 服务器需要两个值（bot token **与** 工作区 Team ID），对话框没有地方放第二个值；而随附的 Atlassian 清单对其声明的远程 OAuth 服务器完全没携带 bearer。

## 探测发现（实时）

**Slack。** `npx -y @modelcontextprotocol/server-slack`（2025.4.25，npm 已标记弃用——参考服务器已移至 `modelcontextprotocol/servers-archived`）在缺少 `SLACK_BOT_TOKEN` 与 `SLACK_TEAM_ID` 任一值时拒绝启动，并且在 token 无效时仍完成 MCP `initialize`/`tools/list`（8 个工具）：Slack API 调用在调用时才失败，因此无效 token 读作 `connected` 服务器。清单现在声明两个引用；归档状态与启动时不鉴权的行为被记录为已知限制，而不是被绕过。

**Atlassian。** `https://mcp.atlassian.com/v1/mcp/authv2` 端点对未认证请求以 `401` 加 RFC 9728 `WWW-Authenticate: Bearer resource_metadata=…` 应答。发现链完整且机器可读：受保护资源元数据 → `auth.atlassian.com` 的授权服务器元数据，后者公告了动态客户端注册端点、唯一支持的 PKCE S256、refresh-token 授权类型与公共客户端令牌鉴权。因此 P3 oauth-flow 引擎可以针对 loopback 回调自行注册客户端，而不要求自带应用（bring-your-own app）。随附清单现在钉住引擎将产生的 bearer：`Authorization: { $cred: atlas }`，由 mcp-client 从令牌存储按连接器 id 以 `Bearer <accessToken>` 解析。

## 决策

1. **每个凭据引用一个字段。** token 方法的 wire 视图现在携带其 `credentialRefs`（公共清单数据——引用名，从不携带值），客户端对话框为每个引用渲染一个密码字段，标签就是引用名本身（技术标识符，非可翻译文案）。所有引用都非空前禁用保存，保存经 `fields.credentials`（host 的按引用映射）在一次 `configure` 调用中存储全部值；`fields.token` 保留为第一个引用的 wire 级快捷方式。
2. **随附清单匹配服务器实际要求。** `slack.yml` 声明 `SLACK_BOT_TOKEN` 与 `SLACK_TEAM_ID`（多引用对话框的真实情形）；`atlas.yml` 的服务器携带上述 bearer 头。
3. **shipped 目录 e2e 是洁净的（hermetic）。** 启动前把 `$DSH_HOME` 指向临时 home：它断言每一行都是 `unconfigured`，而开发者的环境 home（已配置连接器、已挂载服务器）会破坏这一断言。临时 home 获得应用启动所需的 profiles 模块回退修复。

## 考虑过的替代方案

**保留单字段，从 bot token 派生 Team ID。** 被拒：归档服务器并不派生它，而且一个在启动时要求某值的服务器必须声明它；对话框询问服务器所需的就是诚实的界面。

**渲染固定的 "Token" 字段加一个高级自由映射。** 被拒：方法已声明的引用是完整且已校验的集合（清单解析器拒绝引用未声明 ref 的槽位）；自由映射只会让客户端存储 host 本就会拒绝的引用。

**把 Slack 清单切换到受维护的社区服务器。** 搁置：社区候选是 Go 服务器，没有干净的 `npx` stdio 用法，而归档参考服务器仍能启动、列出工具，且只需要两个已声明值。若该包被移出 registry 再重审。

## 后果

- 单引用 token 对话框视觉不变（一个字段，现在标签是引用名而不是 "Token" 一词）；多引用方法（随附 slack、自托管 atlas fixture）每个引用渲染一个字段。
- `dialog.token` 本地化键从三个字典中移除；字段标签是数据，不是文案。
- P3 引擎的契约由随附清单钉住：把令牌包存在连接器 id 之下，现有 `{$cred}` 缝隙就会呈现它。
- 一个已语法存储但被 provider 拒绝的 token 仍显示服务器 `connected`（Slack 服务器启动时不鉴权）；第一次工具调用才是它暴露的地方。

## 相关

- [Connectors P1 — 凭据引用与 preset 名册](../architecture/2026-08-23-connectors-cred-refs-and-presets.md) — 本 note 的 atlas 头所依赖的 `{$cred}` 缝隙。
- [Connectors — the chat-screen region](../architecture/2026-08-23-connectors-chat-region.md) — 本 note 所扩展的区域与对话框。

延迟，按顺序：P3 oauth-flow 引擎（DCR + PKCE + loopback 8766，真实 `connector.complete`），P4 M365 device-code 流程，P5 自定义连接器 UI。
