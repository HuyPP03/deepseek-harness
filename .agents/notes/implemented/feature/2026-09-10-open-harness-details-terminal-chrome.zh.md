# Agent Note: Open Harness 详情栏、文件检视器与终端外观

Status: implemented

[English](2026-09-10-open-harness-details-terminal-chrome.md) | 中文

## 问题

在 Chats / Workspaces / Connectors 仪表盘获得更密的卡片布局与品牌红强调之后，右侧详情列仍像稀疏的 Figma 草稿：细页头配内联关闭图标、平面空状态文案，以及包在本已自带滚动的座位外的额外内边距。文件检视器选项卡与会话文件列表像原型列表；任务日志与终端横幅也未与 CodeBlock / TerminalBlock 共用同一表面家族。

## 决策

在不改变选择与座位路由的前提下，把详情列打磨成 IDE 检视器：

- DetailsPanel 使用分层页头、`IconCloseOutline16`、文件选择时的淡色完整路径副标题、保留既有 `details.empty` 文案的虚线空状态卡片，以及给文件／浏览／任务座位的零内边距 `seatBody`，让这些座位填满列。
- FileInspector 选项卡获得更清晰的品牌红下划线与悬停洗色；加载／空状态变为虚线卡片；代码行号栏分隔更强；FileBrowser 行前导文件夹／文档图标，过滤框带搜索示意。
- TerminalBlock 保留提示符／复制／高度上限契约，仅把横幅与复制悬停改向业务主色洗色。
- JobDetailPanel 的状态行与日志采用同一横幅 + 代码块家族，使后台任务日志在详情座位中读起来像终端输出。
- AppFrame 的详情列不再画第二道左边框；缝线由 DetailsPanel 拥有。
- InputBar 的发送／停止控件改用共享的 `IconSendOutline16`／`IconStopFill16` 原子，而不再内联 SVG。

## 备选方案

**改写 DetailsPanel 空状态文案并增加第二行提示。** 否决：多份规格断言当前 `details.empty` 字符串；外观可在不移动产品文案的情况下改进。

**在 conversation、file-inspector 与 jobs 之间抽出共享的“检视器外观” React 原语。** 否决：slot 系统禁止跨包组件导入，且三个座位不同（工具分区 vs 选项卡 vs 任务日志）。共享外观仍靠 token 与 CSS Module 节奏。

**重排 TerminalBlock 几何（装订线、圆角或提示符布局）。** 否决：测试与工具卡片依赖既有 class 与布局契约；横幅洗色已足以对齐红色强调刷新。

## 后果

- 在右列打开文件、会话文件列表、工具调用或后台任务时，呈现与仪表盘强调语言一致的更密检视器。
- 文件／浏览／任务座位填满详情正文；工具的输入／输出分区保留带内边距的布局。
- 终端与任务日志表面共享偏红的横幅洗色，且不改变文案、ANSI 或高度上限行为。
- 产品可见的 `details.empty` 字符串不变。

## 相关

- [Open Harness 仪表盘、暗色调色板与品牌红色强调](2026-09-10-open-harness-dashboard-and-red-accent.md) — 本外观所跟随的强调色与仪表盘刷新。
- [Web 样式系统](../process/2026-07-19-web-styling-system.md) — token 归属与禁止字面颜色规则。
