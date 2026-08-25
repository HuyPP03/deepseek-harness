# @deepseek-ai/dsh-client-ui-connectors

[English](README.md) | 中文

连接器表面：[侧边栏](../ui-sidebar/README.md) 在其 `connectors` 标签上渲染的已连接 provider 列表，以及 [布局](../ui-layout/README.md) 作为中央区域全列 overlay 安置的浏览目录。一个插件拥有两者：同一个 `apply` 闭包把列表注册进壳声明的 `sidebar.connectors` 孔位、把目录注册进框架声明的 `main.connectors` 孔位，两个注册方共享闭包持有的唯一控制器。

列表是紧凑侧：每个**已连接** provider 一行（状态点 + 名称，用户创建的行带 `Custom` 徽章），每行是一个按钮，点击——或 Enter——在共享控制器中选中该 provider；折叠栏渲染一个请求展开的链接图标。它不持有任何标签状态（壳只在该标签渲染它），挂载时读取名册。

目录是全列：带 **New connector** 的头部（`AddCustomSpec` 字段上的表单——名称、可选 id、stdio 命令/参数或 streamable-http url、可选 token 变量——保存即 `connector.add`）以及每个可连接 provider 一张卡片。每张卡片显示派生状态、连接器描述、客户端侧从无密视图推导的风险注记（连接所依赖且可能失去的 token 引用、授权可能过期的浏览器登录或设备码、未挂载的服务器、自定义连接器的可达性——最多三行、最可操作的在前）、服务器挂载摘要，以及随状态而变的操作：未配置的 token 方式提供 **Configure**（token 对话框，保存即 `connector.configure`——凭据值进入客户端的唯一位置），已配置或失败的连接器提供 **Connect**（token 模式经 `connector.connect`，OAuth 方式经 `connector.authorize`，设备方式经 `connector.deviceLogin`；浏览器流程在新标签页打开返回的 URL 或设备页），存活挂载提供 **Disconnect**（`connector.disconnect`）。自定义卡片另提供 **Remove**（`connector.remove`）。名册通过 `connector.list` wire 动词以无密 `ConnectorView` 到达——没有任何服务器命令、URL、请求头或凭据跨线——卡片与列表读同一个 store。

点击卡片选中 provider，目录切换到其详情：已连接 provider 列出自己的聊天——会话流标记了该 provider `presetId` 的会话，空白条目隐藏，最新在前——每行在对话区打开该会话，**New chat** 在同一 preset 下创建（用该 provider 的 `agentPreset` 调 `session.create` 然后打开）；尚未连接的 provider 保持占位提示直到其第一个会话存在。**Back** 返回卡片网格。详情的会话回调（`openSession`/`newProviderChat`）转发到运行时的会话服务；provider preset id 本身从名册副本解析。详情是这些聊天在侧边栏唯一的展示位置：`apply` 将名册的 preset id 发布在 `connectorPresetIds` ctx 服务下（一个裸快照 store，仅在 id 集合本身变化时才重新发布），[ui-workspace](../ui-workspace/README.md) 的 Chats 标签及其搜索会把运行在这些 preset 上的会话从自己的行中过滤掉，与哪个 surface 先加载无关。

变更把响应的更新视图并入本地名册——响应是权威的，因此不再重新列表，`add`/`remove` 除外（其响应不携带视图，改为重新列表）——卡片级失败渲染在其卡片下方，直到对它的下一次操作。共享控制器对名册读取做单飞：两个表面挂载时都调用 `load`，第二个调用者加入第一个的进行中读取。控制器属于 `apply` 闭包：名册快照（渲染器经 inject `hooks` 分区绑定到 `useConnectors` 的 `createSnapshotStore`）加上变更方法，注册方以普通注入回调触达它们。任一表面重新挂载（离开 `connectors` 标签的切换会卸载 overlay）会重新读取名册，因此视图与宿主一样新鲜，而 apply 闭包控制器比 overlay 活得久。

`ConnectedProvidersListProps` 组合 `sidebar.connectors` owner 份额、`connectors` 语言命名空间与列表 inject 面（`hooks.connectors` store 绑定加 `load`/`selectProvider`）。`ConnectorsDirectoryProps` 组合 `main.connectors` owner 份额、同一语言命名空间与目录 inject 面（store 绑定加 `load`/`openTokenDialog`/`setDialogDraft`/`closeDialog`/`saveToken`/`connect`/`authorize`/`deviceLogin`/`disconnect`/`selectProvider`/`openCustomDialog`/`setCustomDraft`/`closeCustomDialog`/`saveCustom`/`removeCustom`/`openSession`/`newProviderChat`），其上全局标准 hook 已携带 `useSessions` 供详情的聊天列表使用。

`/client` 导出是插件本体（`apply`/`inject`）、两个面的契约类型、控制器类及其状态类型、语言键联合；注册方组件、其子视图、风险注记推导与 CSS 模块保持在插槽注册之后、包内私有。

## 模型体验

无，因为表面渲染宿主派生的连接器视图；此处没有任何内容到达模型请求。对话框发送的 token 在宿主侧存储于连接器的凭据引用下，从不跨线回显。

#### KV 缓存影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

- **OAuth 与设备流程在服务器侧结算** — `connector.authorize` 与 `connector.deviceLogin` 启动流程并返回；验证轮询在宿主运行时，卡片显示该行的 `authorizing` 状态，名册在下次挂载时重读。
- **状态变更没有 wire 推送** — 名册在表面挂载后与每次变更后重读；后台连接器故障在下次访问该标签时显现。
- **自定义表单覆盖单服务器场景** — `connector.add` 背后的 `AddCustomSpec` 每个连接器承载一个服务器与至多一个 token 方式；多服务器或无 token 的自定义部署仍需手写清单。
