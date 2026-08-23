# Agent Note: 连接器——三选项卡、提供商卡片网格与提供商聊天列表

Status: implemented

[English](2026-08-24-connectors-provider-card-grid-and-chat-list.md) | 中文

## 问题

连接器区域此前只在侧边栏的一个选项卡里以行列表呈现，提供商（github、slack、…）既没有自己的聊天列表，也没有从新会话界面进入的入口。产品诉求（2026-08-23）是：侧边栏显示三个选项卡（Chats | Workspaces | Connectors），Connectors 选项卡把提供商渲染为卡片网格；点击已连接的提供商后，该选项卡展示这个提供商自己的聊天列表（按 preset 过滤、最新在前），并提供"New chat"按钮。

新会话界面的 preset 选择器（`AgentPresetSeat`）此前列出全部 preset，包括被某个连接器声明的 provider preset。provider preset 是连接器的"自己的模式"——它的家在 Connectors 选项卡里——所以新会话选择器应当隐藏它，而设置页保留完整名单（它管理 preset）。

## 决策

1. **三个选项卡。** `ui-sidebar` 的选项卡列表固定为 Chats、Workspaces、Connectors 三项，New 控件跟随当前选项卡：Chats 显示"New Chat"，Workspaces 显示"New Session"，Connectors 不显示 New（区域自己的"New connector"负责创建条目）。

2. **提供商卡片网格。** `ui-connectors` 把提供商名册渲染为两列卡片网格（卡片保留行解剖：状态点、名称、状态、描述、操作）。卡片的浮起表面重新绑定 l2 滚动条对。

3. **提供商详情展示其聊天。** 点击已连接的提供商后，区域过滤 `sessions.byId` 中 `agentPreset === provider.presetId` 的会话（排除 blank），按 `updatedAt` 降序排列，行点击打开该会话。区域头部提供"New chat"按钮：通过 `ctx.sessions.create({ agentPreset: provider.presetId })` 创建并打开新会话。未连接的提供商仍显示占位符；已连接但无会话时显示空提示。

4. **新会话选择器隐藏 provider preset。** `AgentPresetSeat` 的控制器在 `agentPreset.list` 之外再读一次 `connector.list`，收集每个已组合连接器的 `presetId`，从选择器选项中剔除。设置行和设置部分保留完整名单；一个已经在某个被隐藏的 preset 下运行的会话仍按 id 解析其标签，因此过滤永远不会使既有会话的显示落空。`connector.list` 读取失败或未组合任何连接器时（空集合），选择器显示完整名单。

## 备选方案

**把提供商聊天列表渲染在会话列表里。** 拒绝：提供商聊天是连接器的关注点，不是会话列表的关注点；在 Connectors 选项卡里按 preset 过滤，让每个提供商的聊天有自己的归属，不污染全局列表。

**让 `presetOptions` 本身过滤 provider preset。** 拒绝：`presetOptions` 是设置行和设置部分共享的选项构造器；过滤只应作用于新会话选择器这一条路径，设置面保留完整名单。

**让 seat 通过 wire 订阅连接器名册。** 拒绝：这是纯客户端过滤（用户确认的设计决策），不需要 host 改动；seat 直接读 `connector.list` 即可，不引入新的 wire 通道或 host 行为。

**把"New chat"放在会话列表头部而非提供商头部。** 拒绝：新会话属于该提供商——它的 preset 由提供商声明——放在提供商头部让归属更清晰。

## 后果

- 侧边栏的 New 控件现在跟随选项卡：标签和动作随当前选项卡变化，Connectors 选项卡不显示（区域自己的"New connector"负责该表面）。
- 提供商详情视图是用户在不经过新会话选择器的情况下以 provider preset 开始会话的唯一入口——选择器隐藏了该 preset，所以路径是提供商自己的"New chat"按钮。
- seat 的过滤是纯客户端：host 仍按 provider preset 组合会话，wire 视图仍携带 `presetId`。将来 host 侧若从名册移除 provider preset，过滤将成为空操作。
- 卡片网格的滚动条重绑定遵循指针揭示约定：浮起表面重绑定 l2 对，gate 只允许两个重绑定目标（l2 对或 `transparent`）。
- 提供商详情的会话过滤按 `agentPreset === presetId`，即会话摘要携带的同一字段。一个以 provider preset 开始随后切换的会话（今天不可能——host 拒绝在另一个 preset 下采用既有会话）会离开列表。

## 相关

- [Connectors——聊天界面区域（侧边栏选项卡 + client/ui-connectors）](../architecture/2026-08-23-connectors-chat-region.md)——本注记的侧边栏选项卡与区域注册。
- [Connectors P1——凭证引用与 preset 名册](../architecture/2026-08-23-connectors-cred-refs-and-presets.md)——`presetId` 字段，详情视图与 seat 过滤都读它。
