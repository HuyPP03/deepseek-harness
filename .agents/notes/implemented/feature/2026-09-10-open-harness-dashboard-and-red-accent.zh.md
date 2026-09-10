# Agent Note: Open Harness 仪表盘、暗色调色板与品牌红色强调

Status: implemented

[English](2026-09-10-open-harness-dashboard-and-red-accent.md) | 中文

## 问题

暗色主题使用冷石墨底加上青绿（teal）强调色（信息按钮、业务状态、用户气泡、侧边栏选中强调，以及 Thinking 状态的文字渐变）。青绿把产品身份从浅色主题已使用的品牌红色阶中拆开；Chats / Workspaces / Connectors 全列仪表盘也过于稀疏：平面列表或低对比卡片网格、只有标题的页头，以及像整页一样撑满列的连接器侧边栏空状态。

## 决策

暗色模式保留冷石墨表面色阶（`--oh-static-cool-50..950`），并把全部品牌／业务别名改指已有的 `--oh-static-brand-*` 红色：信息按钮、`--oh-alias-state-business-primary`／`tertiary`、用户气泡与高亮、以及侧边栏选中项强调。青绿静态 token 已删除。暗色下的悬停／激活洗色混入品牌红，而不再是纯白叠层。Thinking 状态渐变已经读取 `--oh-alias-state-business-primary`，因此随红色别名生效，组件无需改动。

三个仪表盘共用同一页布局：居中内宽（`min(1120px, 100%)`）、标题 + 导语 + 计数（或 CTA）页头，以及响应式卡片网格。Chats 卡片带强调色图标、标题、工作区芯片和相对时间。Workspace 卡片是等高文件夹磁贴（图标、标题、路径、会话计数芯片）。连接器名录卡片保留操作与风险说明，但匹配同一卡片外观；名录页头的 New connector 控件与 New Chat 相同（默认尺寸、前置加号图标、名录计数芯片）；侧边栏已连接提供商列表是紧凑状态列（短空文案，不是居中整页）。

Connectors 选项卡在左侧边栏也获得一个 New 控件，与 Chats（New Chat）、Workspaces（New Session）两个选项卡对齐：侧边栏随选项卡变化的 New 按钮现在在全部选项卡上都显示，在 Connectors 选项卡上打开 New Connector 对话框——与名录页头驱动的是同一个对话框。由于侧边栏壳（ui-sidebar）无法导入连接器控制器（ui-connectors），该对话框以 `connectorNew` 提供的命令形式暴露，由侧边栏在调用时读取，因此两个包之间的 apply 顺序不受约束。

新文案键（`dashboard.subtitle`、`workspaces.subtitle`、`directory.subtitle`、`directory.count.*`、空状态提示）放在所属 locale 词典中；侧边栏的 `connector.new` 标签放在侧边栏词典中。

## 备选方案

**把暗色表面也退回暖石墨（`--oh-static-neutral-warm-*`），同时恢复红色强调。** 否决：冷石墨仍把 Open Harness 暗色与先前的暖近黑区分开；投诉针对的是青绿强调和稀疏仪表盘，而不是冷色表面本身。

**保留青绿作次要强调，仅在 Thinking 渐变上用红。** 否决：第二强调色会重现身份分裂；业务主色别名已经驱动渐变、状态点和选项卡外观，一次红色映射即可覆盖。

**在三个包之间抽出共享的仪表盘 React 原语。** 否决：slot 系统禁止跨包组件导入，且三套网格不同（聊天新近度 vs 工作区文件夹 vs 连接器操作）。共享外观靠 token 与 CSS Module 节奏，而不是新的公开组件。

## 后果

- 暗色强调、Thinking 状态渐变、信息按钮、用户气泡以及页头选中选项卡都走品牌红；浅色模式不变。
- Chats、Workspaces、Connectors 仪表盘呈现为带导语的卡片页；Connectors 的 New connector 控件与 Chats 的 New Chat CTA 对齐；连接器侧边栏保持紧凑的已连接提供商列表。
- 左侧边栏在全部选项卡上都显示 New 控件：New Chat（Chats）、New Session（Workspaces）、New Connector（Connectors，通过 `connectorNew` 命令打开名录的对话框）。
- 空状态与导语文案在所属包的 `en`／`vi`／`zh` 中本地化。
- 冷石墨静态 token 仍用于暗色表面；功能 CSS 不点名青绿 token。

## 相关

- [Web 样式系统](../process/2026-07-19-web-styling-system.md) — 本变更遵循的 token 归属与禁止字面颜色规则。
- [连接器——提供商卡片网格、按选项卡的 New 与提供商聊天列表](2026-08-24-connectors-provider-card-grid-and-chat-list.md) — 本布局重新设计的名录网格。
