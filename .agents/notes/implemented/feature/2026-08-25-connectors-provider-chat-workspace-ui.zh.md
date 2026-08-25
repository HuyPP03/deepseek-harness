# Agent Note: Connectors — provider 聊天隐藏其 workspace UI

Status: implemented

[English](2026-08-25-connectors-provider-chat-workspace-ui.md) | 中文

## 问题

provider 聊天（agent 运行 connector preset 的会话）不携带任何代码项目，但三处界面仍向它提供 workspace 机制：hero 的"Choose workspace"选择器、`@` 文件提及源（列出会话项目文件的来源）、以及 `/goal` 与 `/mcp` 斜杠行（长时任务转向与 MCP 服务器列表）。这些在 provider 会话中都是无效的或误导性的。

## 决策

既有的 `connectorPresetIds` 事实——`agentPreset` 落在 connectors 名册 preset 集合内的会话即为 provider 聊天——驱动三处界面的隐藏，全部在客户端侧：

1. **hero workspace 选择器（`client/ui-workspace`）。** `WorkspacePicker` 通过 `useSessions` 读取当前会话的 `agentPreset`，通过 `useConnectorPresetIds` hook 读取 preset 集合；当当前会话是 provider 聊天时它不渲染任何内容。会话自带的"Choose workspace"chip 保持可见但失效——这是不动 `ui-conversation` 的有意取舍。

2. **`@` 文件提及源（`client/ui-file-mention`）。** 其 `candidates`/`warm` 路径询问一个调用时的 `isProviderChat(sessionId)`——列表快照的 `agentPreset` 对照 connectors 集合，惰性读取，因为 connectors 插件可能晚于本插件激活。provider 聊天不列出任何内容，与已寻址的 subagent 相同。

3. **`/` 斜杠菜单（`interaction/commands` + `client/ui-commands`）。** 一条命令可通过其定义上的 `providerHidden` 标志退出 provider 聊天的菜单；host 将其广播到 `CommandDescriptor` 上，客户端的 `menuRowCandidates` 在会话 preset 为 connector preset 时丢弃被标记的行。`/goal` 与 `/mcp` 设置了该标志。直接键入的行仍会到达 host——只隐藏菜单行，与既有的"chat 会话隐藏 `/permission`"规则一致。

## 已考虑的替代方案

**在 host 的 `command.list` 中过滤斜杠命令。** 否决：host 的 `list` 方法是同步的，而 connector 名册是异步读取的；放到 host 侧会迫使低层的 commands 服务缓存并依赖 connectors 域。客户端已经同时持有会话 preset 与 preset 集合，因此过滤放在其输入本已存在的客户端侧。

**以"会话没有 workspace"为门控。** 否决：普通（非 provider）聊天同样没有项目，因此该门控也会从普通聊天中移除这些 workspace 命令。connector-preset 集合才是精确的"这是 provider 聊天"信号，并与 Chats 标签排除保持一致。

**在客户端硬编码隐藏的命令名。** 相比 `providerHidden` 标志被否决：该标志在每条命令上自文档化，并让客户端过滤与"哪些命令是 workspace 相关"解耦。

## 影响

- 在加载 connectors 插件的任意组合中，provider 聊天的 hero 不显示 workspace 选择器、其 `@` 源不列出任何内容、其 `/` 菜单省略 `providerHidden` 行；未组合 connectors 插件的组合不变（集合为空，过滤为空操作）。
- hero 的"Choose workspace"chip 在 provider 聊天中仍可见但失效——这是不编辑 `ui-conversation` 的可接受代价。
- `providerHidden` 是增量的 wire 字段：较旧的客户端忽略该标志并显示这些行；较新的客户端对较旧的 host 只是永远看不到被标记的行。
- `connectorPresetIds` 事实现通过同一 ctx 服务通道服务于四个客户端界面（Chats 标签行、Chats 搜索、hero 选择器、`@` 源、以及 `/` 菜单）。

## 相关

- [Connectors — provider 聊天从 Chats 标签排除](2026-08-25-connectors-chats-tab-exclusion.md) — 本笔记复用的 `connectorPresetIds` 服务与 provider 聊天信号。
- [Connectors — provider 卡片网格、分标签 New 与 provider 聊天列表](2026-08-24-connectors-provider-card-grid-and-chat-list.md) — provider preset 从新建会话 chip 的隐藏。
- [无 Workspace 的输入区打开既有选择器](2026-08-07-workspace-picker-composer-entry.md) — 本改动对 provider 聊天置空的选择器。
