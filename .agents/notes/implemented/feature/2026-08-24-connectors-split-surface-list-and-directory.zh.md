# Agent Note: Connectors——拆分表面：侧栏连接列表 + 主区域浏览目录

Status: implemented

[English](2026-08-24-connectors-split-surface-list-and-directory.md) | 中文

## Problem

一次会话里两个失败：运行时崩溃与 UX 错位。点击侧栏 Connectors 标签中的某个 provider 触发 React 错误 #310（"Rendered more hooks than during the previous render"）并毁掉整个 app，因为区域里的 provider 详情把会话 hook 只放在条件分支里调用，使列表/详情两种渲染的 hook 数量不一致。幸存的布局也与自己的列打架：完整名册、卡片网格、provider 详情、token 对话框与自定义连接器表单全挤在 56px 到几百像素的侧栏里，详情的聊天列表与表单字段没有空间，而用户真正来 Connectors 找的——已连接 provider 的聊天——打开进侧栏从未触及的对话列。

## Decision

把一个域拆分到它已经横跨的两列，布局拥有接缝：

1. **布局获得全列中央视图。** 布局 store 携带 `centerView: 'conversation' | 'connectors'`（经 `ctx.layout.setCenterView` 设置，导出为 `CenterView`），AppFrame 声明 `main.connectors` 孔位，渲染为绝对定位覆盖在中央列上的 overlay。对话列保持挂载在下方，切换永不丢失会话状态。

2. **侧栏标签驱动中央视图，目录把视图还给它。** `SidebarRoot` 在 connectors 标签上推 `setCenterView('connectors')`，在其它任何标签上推 `setCenterView('conversation')`，经由注入的 `setCenterView` 回调；加载时的持久化标签恢复走同一路径，标签点击即使标签已激活也重申视图。唯一的返回路径：从目录打开会话（聊天行或 **New chat**）在与 `sessions.open` 同一步调用 `setCenterView('conversation')`——聊天打开在 overlay 覆盖的对话列，侧栏标签留在 connectors，下一次点击该标签把目录带回来。

3. **ui-connectors 在一个控制器上注册两个表面。** 同一个 `apply` 闭包把 `ConnectedProvidersList` 注册进 `sidebar.connectors`、`ConnectorsDirectory` 注册进 `main.connectors`，两个面都绑定闭包的唯一 `ConnectorsSectionController` store。列表面是最小选择子集（`load`/`selectProvider`）；目录面携带完整回调集。两个表面挂载时都调用 `load`，控制器对名册读取做单飞，因此两次挂载只花宿主一个 wire 动词。

4. **侧栏只保留已连接的 provider** ——状态点、名称、`Custom` 徽章——每行一个，点击或 Enter 选中 provider。完整名册以卡片网格形式移到目录：状态、描述、服务器摘要与随状态而变的操作（Configure/Connect/Disconnect/Remove）现在渲染在足够宽的列里。卡片点击启动其状态与凭据方法所需的流程——token 对话框、浏览器 OAuth 流程、设备码流程或普通连接——只有存活或正在结算的卡片打开详情。Connect 动作本身扩展到所有有路径的未连接状态：`needs-auth`、挂载失败（`down`/`error`）、未配置的浏览器登录或设备码；token 方法在 token 存储前仍提供 Configure。

5. **风险注记客户端侧从无密视图推导。** 每张卡片最多列出三行失效模式——连接所依赖的 token 引用（及已存 token 的可撤销性）、授权可能过期的浏览器登录或设备码、未挂载服务器数量、自定义连接器的可达性——最可操作的在前。无 wire 变更：一切来自名册已携带的 `ConnectorView` 字段。

6. **provider 详情与自定义表单位于目录。** 所选 provider 的聊天（按 preset 过滤、空项隐藏、最新在前）与 **New chat** 全宽渲染；token 对话框与 **New connector** 表单在目录之上打开。

## Alternatives considered

**整个名册留在侧栏，只修崩溃。** 拒绝：崩溃修复（无条件运行会话 hook）保留，但侧栏列无法在可用宽度内容纳聊天列表与表单；provider 的聊天属于对话列的邻域，目录的卡片需要空间放风险注记与服务器摘要。

**给目录自己的顶层导航入口（第四个侧栏标签或头部按钮）。** 拒绝：侧栏的 connectors 标签已经是用户进入"连接"的心智入口；第二个入口会拆分该域的导航并让两者漂移。标签保持唯一门户，移动的东西只有布局的 overlay。

**把目录拆成独立插件包。** 拒绝：一个域、一个控制器、一个 wire 动词——同一注册方的两个座位。第二个包要么复制控制器，要么发明插槽系统明确拒绝托管的跨包状态通道。

## Consequences

- AppFrame 的 `main.connectors` overlay 绝对定位在中央列上；会话树保持挂载（无状态丢失），标签离开 connectors 时 overlay 整体卸载——apply 闭包控制器比两个表面都活得久。
- 侧栏的 `sidebar.connectors` 面按契约保持最小；未来需要该域更多部分的表面读目录面或共享 store，而不是加宽的列表面。
- 风险注记是 `connectors` 命名空间的文案（`risk.*`），在包内 `risks.ts` 推导；wire 保持无密且不变。
- 2026-08-24 卡片网格决定内容幸存、位置迁移：网格现在是目录的卡片网格，侧栏的每标签 New 控制规则不变。
- token 对话框是凭据值进入客户端的唯一位置；它随目录迁移，其 `configure` 保存路径不变。

## Testing

- #310 回归测试在真实 `createSnapshotStore` 绑定上渲染目录，并切换 provider 选择 列表 → 详情 → 列表 → 详情；条件调用的会话 hook 会使其失败。
- 两个注册面、共享 store 身份与单飞读取在 `apply.client.spec.ts` 断言（两个入口共一个 `ConnectorsSectionController`，列表与目录面不同，`load` 汇合）。
- 风险注记推导作为纯函数覆盖（`risks.client.spec.ts`）；卡片的风险行、浏览器/设备流程启动（含被拒流程的吞掉与缺失验证 URI 的空操作）、详情的 preset 过滤聊天列表在 `directory.client.spec.tsx` 断言。
- 包客户端源码达到逐文件 100% 覆盖门禁；`pnpm run test:gui` 与仓库 typecheck 通过。

## Related

- [Connectors——provider 卡片网格、每标签 New 与 provider 聊天列表](2026-08-24-connectors-provider-card-grid-and-chat-list.md) —— 本 note 把网格与聊天列表决定移到主区域的原始决定；其每标签 New 规则与 preset 过滤幸存。
- [Connectors——聊天屏区域](../architecture/2026-08-23-connectors-chat-region.md) —— 本 note 重新安置的区域与对话框。
- [Connectors P1——凭据引用与 preset 名册](../architecture/2026-08-23-connectors-cred-refs-and-presets.md) —— 风险注记推导所基于的无密 `ConnectorView`。
