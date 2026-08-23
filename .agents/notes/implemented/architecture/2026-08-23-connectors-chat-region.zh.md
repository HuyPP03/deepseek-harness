# Agent Note: Connectors — the chat-screen region (sidebar tab + client/ui-connectors)

Status: implemented

[English](2026-08-23-connectors-chat-region.md) | 中文

## Problem

P0a 赋予了连接器宿主侧身份、`connector.*` 动词和内置目录，但聊天屏幕没有界面来浏览、配置、连接或断开它们。客户端需要一个令牌录入入口，且客户端绝不能保留密钥；侧边栏也需要在花名册与聊天列表、Workspace 树并列的浏览位置。

## Decision

两部分：

1. `client/ui-sidebar` 增加第三个浏览标签。标签 store 现在是 `chats | workspaces | connectors`，持久化为 `dsh.sidebar.view.v2`，默认 `chats` —— 旧 `v1` 键下的值视为不存在。外壳声明新的 `sidebar.connectors` 子 slot（single、root 作用域），并在该标签上把区域换成注册者；connectors 标签上的字标与新建和 chats 标签一样启动聊天（不启动 Session Intent）。折叠与轨道行为不变。

2. `client/ui-connectors` 是新的插件包，通过 `ctx.slots.inject('sidebar', ...)` 把名册区域注册进 `sidebar.connectors` 孔。区域列出结构上不含密钥的 `ConnectorView` 行（状态点、服务器数、lastError），并驱动钉死的"状态到动作"映射：未配置的 token 方式提供配置对话框，`needs-auth`/`down`/`error` 提供连接，`connecting`/`connected`/`reconnecting` 提供断开，`authorizing` 不提供动作。令牌对话框是客户端录入凭据值的唯一位置；草稿通过 `connector.configure` 发送一次，成功后清除。控制器由 apply 闭包持有，组件通过注入的 `hooks` 舱室以 `useConnectors` 触达它。控制器的 api 面刻意限定为区域用到的四个线调用（`list`、`configure`、`connect`、`disconnect`）—— `complete`、`add`、`remove` 保留在宿主侧，直到 oauth-flow 引擎与自定义连接器 UI 落地。变更响应携带权威的操作后视图，页面把它并入自己的名册而不重新拉取，单一在飞 `busyId` 一次性门控所有行动作。轨道渲染一个请求展开的链接图标。

所有行文案走 locale 字典，`en` 为键集事实源，`zh` 与 `vi` 跟随。

## Alternatives considered

**把名册渲染进 `sidebar.workspaces` 区域内部。** 被拒绝：连接器不是会话或 workspace 关注点；外壳拥有的标签加孔位给了名册一等公民位置，且不触动 ui-workspace 的所有权边界。

**按行的忙状态与按行的错误队列。** 被拒绝：单一在飞变更与宿主侧单一凭据存储相匹配，单飞门控让控制器保持简单；行错误仍按行记录。

**每次变更后重新拉取名册。** 被拒绝：宿主从变更刚提交的同一组目录、凭据与注册表事实推导视图，响应行是权威的，重拉是无用的往返。

## Consequences

聊天屏幕现在承载连接器界面，且对话框关闭后客户端不保留任何密钥：`list` 在宿主侧结构上不含密钥，对话框草稿在保存后清除。代价：侧边栏持久化键移到 `v2`，之前的标签选择重置为 `chats`；未组合 connectors 服务的部署显示空状态（这是有效部署，不是错误）。一个值得保留的维护事实：客户端测试通过 tsconfig `paths` 把 workspace 导入解析进 `src`，因此客户端包 `src/` 里残留的构建产物 —— 或过期的 `lib/` —— 会破坏该解析，并把失败归因到错误的地方（在不相关文件上报告 `window is not defined`）；任何构建之后保持源平面干净。

## Related

- [Connectors — the host foundation](2026-08-23-connectors-host-foundation.md) —— 此页面驱动的状态机与动词。
- [Slot system standard](2026-07-22-slot-type-chain-implementation.md) —— 新孔位背后的组合模式。

按顺序延迟：P1 mcp-client 的 `{$cred}` 占位与 preset 名册、P3 带真实 `connector.complete` 的 oauth-flow 引擎、P4 device-code 流、P5 自定义连接器 UI。
