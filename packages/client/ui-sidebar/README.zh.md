# @deepseek-ai/dsh-client-ui-sidebar

[English](README.md) | 中文

侧边栏外壳插件：负责字标、新建操作、浏览标签、布局持有的折叠控件、可感知滚动的区域 seat，以及固定在底部的 Settings seat。[ui-workspace](../ui-workspace/README.md) 持有渲染到 `sidebar.workspaces` 的 Session 浏览器；本包既不派生其中的行，也不持有其视图偏好。折叠到布局拥有的 56px 轨道仍属于本地呈现行为。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

外壳持有浏览标签 store（`chats` ｜ `workspaces` ｜ `connectors`，持久化为 `dsh.sidebar.view.v2`，默认 `workspaces`）：展开栏在新建按钮上方渲染三标签列表，当前标签决定区域 registrant——`chats` 与 `workspaces` 把标签交给 `sidebar.workspaces` owner（平铺聊天列表或 Workspace 树），`connectors` 则把区域换成 `sidebar.connectors` registrant（[ui-connectors](../ui-connectors/README.md) 列表）。标签是中央列全列视图的唯一驱动：外壳在 connectors 标签上推 `setCenterView('connectors')`、在其它标签上推 `setCenterView('conversation')`，因此[浏览目录](../ui-connectors/README.md) 恰好在标签显示列表时覆盖会话列（加载时的持久化标签恢复走同一路径）。字标与新建按钮跟随当前标签：Workspaces 以 “New Session” 启动运行时的页面局部前端 Session Intent，Chats 以 “New Chat” 启动聊天（复用当前空白聊天会话或以 `agentPreset: 'chat'` 新建并打开）；`connectors` 标签不渲染新建控件（该区域自带的 “New connector” 负责创建条目）。轨道没有标签控件，其新建图标跟随已持久化的标签。

New Session 会启动运行时的页面局部前端 Session Intent。运行时优先使用作用域操作明确指定的 Workspace，否则使用当前 Session 所属 Workspace，再否则使用最近活跃 Workspace；一个 Workspace 都没有时则清空选择，进入空白 New Session 页面。Workspace 专属控件与共享选择器由 ui-workspace 持有。

`SidebarRootComponentProps` 组合布局 owner share、全局 `useSessions` 和 `useWorkspaces` 钩子、已声明的 `sidebar.workspaces`、`sidebar.connectors` 与 `sidebar.settings` 子 slot、外壳标签 store，以及注入的 `startSession`／`startChat`／`setCenterView` 与侧边栏切换回调。

实时收起时，外壳会把展开内容固定在当前宽度，并用 150ms 将其淡出。随后，上方四个控件——外壳的侧栏切换与新建会话，以及通过 `sidebar.workspaces` 渲染的添加和搜索——共用一次 150ms 的淡入和 49px 左移，在布局的 300ms 栏滑动结束时一起进入 56px 轨道；每个 36px 控件盒都会沿同一条路径到达轨道左侧 10px 的内边距。固定在底部的 `sidebar.settings` 控件只共用淡入时序，不发生横向位移。页面初始即为收起状态时会静态渲染轨道；减少动态效果模式会禁用两段过渡。

栏内的滚动条是一种指针可供性：只要指针不在栏内，外壳就把 ui-theme 的[滚动条间接层](../ui-theme/README.md)重新绑定为 `transparent`；指针离开后滑块再保留 2 秒，因此没人指向的列表不会带着滚动条。避免行位移的空间预留属于滚动区域本身（[ui-workspace](../ui-workspace/README.md)），所以显示滑块不会引起重排。

页脚承载 `sidebar.settings`：侧边栏只渲染固定在底部的布局 slot，并共享其栏状态（`wide`）；ui-settings 在此注册触发行和设置面板。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；SidebarRoot、行组件和树派生仍由 slot 注册封装在包内。

## 模型体验

无。侧边栏渲染浏览器会话列表；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **Session 状态点渲染由 [ui-workspace](../ui-workspace/README.md) 持有**：没有可用的 done/error 通知数据源。
- **Workspace 浏览行为由组合持有**：分组、排序、搜索与行状态都属于 [ui-workspace](../ui-workspace/README.md)，不属于此外壳。
- **「New task completed」未读标记是本地查看状态**：完成时间 > 上次查看时间这一事实永远不会到达宿主。
