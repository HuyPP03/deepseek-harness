# @deepseek-ai/dsh-client-ui-connectors

[English](README.md) | 中文

连接器侧边栏区域：[侧边栏](../ui-sidebar/README.md) 在其 `connectors` 标签页上渲染的预定义外部连接列表，以及令牌对话框——凭据值进入客户端的唯一入口。本区域注册到壳声明的 `sidebar.connectors` 插槽；它不持有任何标签页状态（壳只在该标签页渲染它），折叠栏渲染一个请求展开的链接图标。

列表通过 `connector.list` 线协议动词以无密文的 `ConnectorView` 到达——服务器命令、URL、请求头或凭据一律不跨线。每行显示派生状态（状态点 + 标签）、连接器的描述，以及其服务器挂载摘要。行操作跟随状态：未配置的令牌方式提供**配置**（令牌对话框，保存即 `connector.configure`），已配置或失败的连接器提供**连接**（以 token 模式调用 `connector.connect`），存活挂载提供**断开**（`connector.disconnect`）。变更采用响应中更新后的视图并入本地列表——响应即权威，因此不再重新拉取——行级失败渲染在其行下方，直到对该行的下一次操作。

区域在其 `apply` 闭包中拥有一个控制器：列表快照（渲染器通过 inject `hooks` 组件绑定到 `useConnectors` 的 `createSnapshotStore`）以及变更方法，区域以普通注入回调的方式触达它们。区域重新挂载（标签页切换）会重新读取列表，因此视图与宿主一样新鲜。

`ConnectorsRegionProps` 组合壳 owner 份额（`wide`、`expandSidebar`）、`connectors` 语言命名空间，以及 inject 面（`hooks.connectors` 存储绑定，加上 `load`/`openTokenDialog`/`setDialogDraft`/`closeDialog`/`saveToken`/`connect`/`disconnect`）。

`/client` 导出仅为插件本体（`apply`/`inject`）、契约类型、控制器类及其状态类型、语言键联合；区域组件、其行子视图和 CSS 模块保持在插槽注册之后、包内私有。

## 模型体验

无，因为该区域渲染宿主派生的连接器视图；此处没有任何内容到达模型请求。对话框发送的令牌在宿主侧存储于连接器的凭据引用下，且从不跨线回显。

#### KV 缓存影响

无；本程序既不组装也不发送供应商请求。

## 已知限制与延后工作

- **OAuth 与设备码流程仅渲染指引** — 以这些模式调用 `connect` 在宿主侧拒绝（`connector-auth-unavailable`），直到 oauth-flow 引擎落地；期间行上显示该方式的 `howTo`/`setupGuide` 文案。
- **状态变更没有线协议推送** — 列表在区域挂载后和每次变更后重新读取；后台连接器故障要到下次访问该标签页才显现。
- **自定义连接器表单只覆盖单服务器场景** — `connector.add` 的 `AddCustomSpec` 每个连接器只承载一个服务器与至多一个令牌认证方式；多服务器或无令牌的自定义部署仍需在清单中手写。
