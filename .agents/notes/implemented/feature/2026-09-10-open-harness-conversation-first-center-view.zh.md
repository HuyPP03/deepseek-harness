# Agent Note: 会话优先的中心视图与会话打开返回

Status: implemented

[English](2026-09-10-open-harness-conversation-first-center-view.md) | 中文

## 问题

顶栏标签（Chats / Workspaces / Connectors）现在各自会在中心视图打开整列 dashboard，因此中心视图会在会话与 dashboard 之间切换。由此出现两种失效模式：

1. **冷启动被 dashboard 盖住。** 默认标签的 dashboard 在挂载时镜像进中心视图，在用户尚未做任何操作之前，就把会话 hero（或已打开的会话）遮在了覆盖层后面。
2. **会话打开可能把用户困在 dashboard 上。** 当会话中存在阻塞式交互（plan 审批、ask-user 提问、workflow 成员）时，从浏览区域点击会话行或卡片会重新选中*当前已是*的会话。session store 把这种重开视为无操作（no-op），因此 header 的 session-yield 效果（当一个会话变为当前时把中心视图切回会话）不会重新触发，中心视图就一直被 dashboard 盖住——待处理的卡片无法到达，e2e 点击也会超时，因为 dashboard 覆盖层拦截了指针事件。

## 决定

中心视图遵循**会话优先**：

- 冷启动渲染会话——没有当前会话时是 hero，否则是当前会话。header 的标签镜像效果跳过首次渲染（`isFirstRender` ref），因此启动时永远不会盖住会话。默认标签是 Chats。
- 顶栏标签*点击*是唯一会把其 dashboard 镜像进中心视图的浏览手势。
- 来自浏览区域的每条会话打开路径——sidebar 的 `open`、Chats dashboard 卡片、Workspaces dashboard 卡片、connector 目录——都在 `ctx.sessions.open(sessionId)` 的同一调用里调用 `ctx.layout.setCenterView('conversation')`。这覆盖了"重开当前已是会话"的情形：仅靠 store 变更不会重新触发 yield。`startChat` / `startSession` / fork 路径创建的是*新*会话 id，因此依赖 yield 效果，不调用 `setCenterView`。

`ui-workspace` 的 `inject` 列表新增 `layout` 服务（外加 `oh-client-ui-layout` devDependency 与 tsconfig 引用），用于显式返回。

## 备选方案

**标签点击只改 sidebar（不镜像中心视图）。** 否决：这次重设计的意图就是每个标签进入其 dashboard；只改 sidebar 区域的标签点击会让标签显得失灵。

**仅靠 session-yield 效果返回会话。** 否决：重开当前已是会话对 session store 是无操作，yield 不会触发，用户会一直困在 dashboard 上。显式的 `setCenterView('conversation')` 让每条打开路径的返回都是确定性的。

**一旦出现阻塞式交互就把中心视图自动切回会话。** 否决：那会把用户从他们主动打开的 dashboard 里拽走；改为在用户自己的下一个导航手势（打开会话）时返回。

## 后果

- 从任意 dashboard 或 sidebar 区域打开会话，都会在同一调用里把中心视图切回会话；任何路径都不会让待处理卡片被 dashboard 盖住。
- 在卡片待处理时断言 sidebar/dashboard 行的 e2e 场景，必须先以行点击返回（这是自然的用户手势）再点卡片——`plan-review` 与 `question-composer` 正是这样做。
- `ui-workspace` 现在依赖 `@open-harness/oh-client-ui-layout`（仅类型的 context 合并，外加 `setCenterView` 调用）。
- 启动覆盖层回归由 `HeaderRoot` client 测试覆盖（首次挂载不写 center-view；每次标签点击写一次；session-yield 效果把视图切回会话）。

## 相关

- [Open Harness dashboards、暗色面板与品牌红强调色](2026-09-10-open-harness-dashboard-and-red-accent.md) —— 该返回手势所离开的 dashboard 表面。
- [Web 会话与 sidebar 浏览标签](2026-08-20-web-chat-sessions-and-sidebar-tabs.md) —— 顶栏标签所镜像的 sidebar 标签 store。
