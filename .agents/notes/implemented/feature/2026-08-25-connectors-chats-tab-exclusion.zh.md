# Agent Note: Connectors — provider 聊天从 Chats 标签排除

Status: implemented

[English](2026-08-25-connectors-chats-tab-exclusion.md) | 中文

## 问题

provider 详情已经列出了已连接 provider 自己的聊天，但侧边栏的 Chats 标签——以及它的搜索——又把同样的会话当作普通未分组行再列一遍。一个 provider 会话因此出现在两个浏览位置，搜索命中 provider 聊天的标题或正文时，也会从 Chats 标签打开它，而不是从 provider 自己的详情打开。

## 决策

provider 详情成为 provider 聊天唯一的浏览位置，通过一个跨插件的客户端服务实现：

1. **`client/ui-connectors` 发布名册的 preset id。** `apply` 提供 `connectorPresetIds` ctx 服务：一个 `createSnapshotStore<ReadonlySet<string>>`，由一个 effect 从共享 controller 的名册同步。只有当 id 集合本身变化（大小或成员）时才重新发布，因此保持名册不变的选中或对话框变化对消费者是无操作快照。

2. **`client/ui-workspace` 惰性消费为一个稳定 source。** browser inject 面新增 `hooks.connectorPresetIds` 条目（renderer 把它绑定为 `useConnectorPresetIds`）。两个插件的激活顺序不受约束，所以消费方持有一个本地快照 store 来镜像该服务：初始为空，在 `internal/service` 账本事件上重新绑定，provider 销毁时回到空集。该 hook 恒存在；未组合 connectors 插件的部署只是不过滤任何东西。

3. **`deriveChats` 和 `deriveSearchResults` 把该集合作为纯数据参数接收**，丢弃所有 `agentPreset` 在其中的会话——行和搜索一并，标题匹配和后端内容命中一并。组件通过绑定的 hook 读取集合，并以数据形式向下传递；hook 本身不跨越组件边界。

## 备选方案

**在注册时于 inject 工厂里直接捕获 `ctx.get('connectorPresetIds')`。** 否决：renderer 按 entry 缓存 root inject 面，而 connectors 插件可能在工作区浏览器已绑定之后才激活（激活顺序不受约束）。在绑定时捕获会把空 source 固定到整个会话生命周期。

**让 ui-workspace 把该服务声明为硬依赖（inject）。** 否决：`inject` 会等待被命名的服务，而 connectors 插件是可选的组合成员——没有它的部署会让工作区浏览器的激活卡在一个永远不会到达的 provider 上。

**改在 host 会话 feed 上过滤。** 否决：feed 是所有 surface 共享的会话列表投影；provider 详情本身也是从同一个 feed 按 `agentPreset` 过滤的。在 feed 层隐藏 provider 会话会迫使详情自带一份会话列表，而"哪些 preset 是 connector preset"这个事实属于 connectors 名册，不属于会话域。

## 后果

- 在组合了 connectors 插件的任意部署中，无论哪个 surface 先激活，provider 聊天都会离开 Chats 标签的行和它的搜索。
- Chats 标签持久化的 `sessionOrderByAccount` 未分组顺序会保留 provider 聊天的位置：行缺席，但顺序数组中的条目保留到该账户的下次保留清理。
- 未组合 connectors 插件（或尚未加载）的部署看不到任何变化：source 是空集，过滤是无操作。
- `connectorPresetIds` 服务是一个裸快照 store——两个浏览插件之间第一个跨插件的反应性事实，经由 ctx 服务通道携带，而不是经由 slot（两个 surface 之间不存在 slot 洞）。

## 相关

- [Connectors — provider 卡片网格、按标签的 New、provider 聊天列表](2026-08-24-connectors-provider-card-grid-and-chat-list.md) — 本排除补全的详情列表；provider preset 从新会话 chip 中隐藏。
- [Lazy MCP tool bridge（惰性 MCP 工具桥）](2026-08-25-lazy-mcp-tool-bridge.md) — 本 PR 中 2026-08-25 的另一个 connectors 变更。
