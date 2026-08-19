# Agent Note: Web 聊天会话与侧边栏浏览标签

Status: implemented

[English](2026-08-20-web-chat-sessions-and-sidebar-tabs.md) | 中文

## 问题

Web 侧边栏的会话浏览器只有一条列表：每个会话要么挂在某个 Workspace 组下，要么落在尾部的「未分组」桶里。没有 Workspace 的普通对话会话与 workspace 残留混在同一个桶中，启动它们只有主视觉区的「不选择项目」动作一条路。产品需要一个一等公民的聊天界面：独立的会话种类、专属的侧边栏标签、新建聊天动作，以及固定为 read-only 而非可选择的权限模式。

## 决策

**聊天会话**是没有 `workspaceId` 且 `agentPreset: 'chat'` 的会话——单一耦合 id，`CHAT_PRESET_ID`，由客户端运行时（`@deepseek-ai/dsh-client-runtime/client`）导出，所有 UI 分支方消费它。host 侧按 preset 固定行为：

- `dsh-permission-presets` 增加 `Config.chatPresetIds`（哪些 agent-preset id 的会话是聊天；Web 界面随附 `chat`）与 `Config.chatPreset`（默认 `read-only`）。以列表中的 preset 创建的会话在创建时固定聊天预设而非默认预设，`/permission` 切换会拒绝任何仍运行列表中 preset 的会话。Web 补丁（`cordis.patch.yml`）在权限行上设置 `chatPresetIds: [chat]`。
- Web 界面注册 `chat` agent preset（`apps/cli/config/agent-presets/chat/`），带聊天系统提示词；`webSurfacePrompt` 接收 chat 标志。
- `session.create` 本就接受并回显 `agentPreset`，因此不需要 wire 变更；客户端经 `sessions.create` 把它接通。

客户端侧，外壳持有标签：

- `ui-sidebar` 增加一个小型 store（`dsh.sidebar.view.v1`，默认 `chats`）与双标签控件（仅展开栏；轨道跟随已持久化的标签）。当前标签是 `sidebar.workspaces` owner 属性，region 在平铺聊天列表与 Workspace 树之间重渲染；字标与新建按钮按标签分发——Workspaces 保持既有的 New Session intent，Chats 调用注入的 `startChat`。
- `WorkspaceRuntime.startChat()` 复用列表镜像中已按 `CHAT_PRESET_ID` 创建的未分组空会话（blank 复用，并发调用合并），未命中则调用 `session.create({agentPreset: CHAT_PRESET_ID})`。`startNewSession` 的无主分支（主视觉区「不选择项目」）现在也铸造聊天会话，主视觉区因此落在聊天种类上。
- `ui-workspace` 移除未分组桶与分组／单列表视图选项。Workspaces 标签只渲染 Workspace 树（workspace 组，无未分组回退）；Chats 标签渲染所有未被任何 Workspace 记账的会话的平铺列表（`deriveChats`），未分组顺序记账键保留（store key 从 `dsh.workspace.view.v5` 提升到 `v6`）。聊天行携带 `blankChat`，空白占位符因此渲染「新聊天」；搜索与悬浮呈现把聊天会话标记为**聊天**。拆分之前创建的旧未分组会话在聊天列表中保留其普通会话呈现。
- 聊天界面隐藏权限机制，因为 host 会拒绝它：`InputBar` 对 `agentPreset: 'chat'` 会话不渲染 Access chip，`ui-commands` 为它们把 host 的 `/permission` 行从候选菜单中滤掉（手输入的行仍会到达 host 并收到其错误——有意为之：客户端只隐藏菜单，host 负责强制），`ui-permission-presets` 装饰对它们报告 `available: false`。

## 考虑过的替代方案

**保留未分组桶，只加「聊天」徽标。** 被否：桶混淆了两种不同种类（workspace 残留与普通对话），徽标也给不了侧边栏设计要求的标签级分离。

**只按 `cwd === undefined` 推导「聊天」。** 被否：旧会话没有 cwd 但由旧默认流程创建；按 preset 判定让旧行为保持不变，并把新聊天钉在 host 固定的权限模式上。

**为聊天固定加新的会话事件或 wire RPC。** 被否：wire 的 `session.create` 已经携带 `agentPreset`，host 在创建时固定加上切换拒绝——没有新持久事实需要落日志。

## 后果

聊天会话在会话列表中可区分（summary 上的 `agentPreset`），其权限模式由 host 固定并由 host 强制，fork／resume 聊天会话保持聊天行为，因为 preset 随 seed 传递。标签状态是浏览器本地视图状态（独立 key 持久化，无 host 往返）。按预发布立场执行：workspace 视图 store key 直接提升而非迁移，移除的分组／单列表视图选项不保留兼容垫片。重放浏览器快照的侧边栏预期已更新为带标签的壳；GUI PR 附带录制的交互 GIF。
