# Agent Note: 会话引用项目（Session Reference Projects）

Status: implemented

[English](2026-08-18-session-reference-projects.md) | 中文

## 问题

会话的**引用项目**（reference projects）是附加到一个会话、用于对照的项目目录集合——但不包含会话工作区本身。这是 [@deepseek-ai/dsh-workspace-references](../../../../packages/workspace/workspace-references/README.md)（`ctx.workspaceReferences`）拥有的日志层事实，属于 workspace 家族。

## 决定

- **事件是整值的。** 每次变更追加一条携带完整规范路径列表的 `workspace/references` 事件；日志中最后一条事件即当前附加集合，空列表表示全部分离。这沿用 `sandbox/mode` 的先例：每次变更一条事件、没有 start/update/result 家族、仅日志（无 `surfaceOp`、无 Conversation Node），并配有 companion invariant，检查每条记录的路径都是绝对、非空且绝不等于会话自身的 `header.cwd`。
- **上限是配置字段而非常量。** `Config.maxReferences`（默认 2，最小 1）约束引用列表；会话工作区不计入，因此默认部署最多把主项目与两个项目对照。API 网关把该界限以 `REFERENCE_PROJECTS_MAX`（2）暴露在 wire 上，UI 从 `workspaceReferences` 投影读取实时界限，因此提高配置的部署无需改动客户端。
- **可写性由现行沙箱模式决定，而非新的检查。** 所有受限沙箱后端本来就允许读取会话工作区之外的目录，因此被接纳的引用目录在任何模式下都可直接读取；让它们可写是沙箱词汇层的决定，不是本包的决定。`workspace-refs-write` 模式（[沙箱笔记](../feature/2026-07-06-sandbox.md)，基础 bundle 的 `write-workspace` preset——'Write All'）把附加的引用根目录并入可写集合：`resolve()` 以 `referenceRoots` 携带它们（仅该模式消费此字段），`writableRoots` 把它们折入共享允许列表，每个后端都与工作区根目录一并授权。
- **提示词段。** 模型通过一个提示词段看到引用。`workspace:references`（order 115，在 `sandbox:policy` 之后）渲染一条固定的引导语和每个引用一行路径，无引用时渲染为空。不新增工具：模型用已有的文件工具读取引用。
- **暴露面。** API 网关在 `session.create` 上接受 `referenceWorkspaceIds`（wire 校验到上限；会话首个工作区仍是主项目），并提供整值的 `session.setReferences` RPC 用于会话中途附加/分离。ACP `session/new` 在包已挂载时把 `additionalDirectories` 映射到同一服务，否则以 `invalidParams` 拒绝。客户端投影键 `workspaceReferences`（视图：路径列表加界限）供给 Web UI 的选择器与会话标题栏引用控件；纯聊天——完全没有项目的会话——被允许，并运行在宿主 cwd。

fork 随 seed 继承引用；subagent 子会话不继承（它们运行在自己的工作区，子会话对照父会话的引用需要本设计未提供的契约）。

## 测试

- apiproxy 的规格覆盖：带两个引用 id 的 `session.create`（日志中一条 `workspace/references` 事件、首个模型请求携带 `workspace:references` 段）、第三个 id 在 wire 上被拒绝、命名会话自身工作区的 id 以 `references-invalid` 拒绝；`session.setReferences` 整值替换集合、空列表清空，能力未挂载处以 `references-unsupported` 拒绝。
- ACP 的规格覆盖：已挂载该包的部署上，`session/new` 接受 1–2 个 `additionalDirectories`，以 `invalidParams` 拒绝 3 个或相对路径或自身 cwd 条目；未挂载时以未挂载消息拒绝。
- 无密钥的 ACP 快照场景（`examples/acp-agent`，`reference-directories`、`workspace-refs-write` 下的 `reference-refs-write`，外加 `reject-extra-dirs` 拒绝对照）回放整个暴露面：会话日志中的事件、请求头中知晓策略与引用的提示词段，以及对附加引用项目内文件的一次成功写入。
- Web 的 `multi-workspace-session.e2e.ts` 覆盖选择器（一个主项目加至多两个引用项目、纯聊天）与会话标题栏芯片在投影界限内附加与分离引用。

## 曾考虑的替代方案

- **workspace 注册表成员关系（多项目会话）。** 否决：注册表记录是 UI 归档，设计上对模型不可见，且不是会话日志事件，因此对照上下文无法在不建立第二份冗余事实的情况下变得模型可见。成员关系与引用项目保持正交：一个会话按其主项目归档，无论它引用了什么。
- **`workspace/references/add` / `remove` 事件对。** 否决：每次变更两条事件再加折叠，正是整值 `sandbox/mode` 先例要避免的 start/update/result 家族；整值形式让上限与自身 cwd 排除都能被 invariant 按事件检查。
- **专门的引用读取工具。** 否决：文件工具本来就读取沙箱允许的整个文件系统；专门工具会重复它们，并为同样的访问给模型第二套词汇。
- **仅提示词上下文的实现（无事件）。** 被模型可见 ⟺ 已记录规则否决：该段必须能在 resume、fork 与 replay 时从日志重建出完全一致的内容。

## 影响

- **`workspace-refs-write` 与 `danger-full-access` 解除引用的只读保证**，正如它们解除会话工作区的一样；提示词文本现在告诉模型仅在当前文件策略允许时才修改引用。已接受：每种部署的策略声明已经公告了它所携带的限制。
- **引用目录可能变陈旧。** 附加后引用项目可能被删除或移动；模型随后会看到 `ENOENT` 风格的工具结果。已接受：会话工作区有同样的性质，移动后重新附加是一次 RPC。
- **每个引用在每个提示词请求中增加一行路径加固定的引导语**，默认上限下成本有界且相对于对照买来的上下文很小。
- **注册表保持不知情。** 引用项目的会话仍只按其主项目归档；工作区的会话列表不显示入站引用。有意为之：注册表是归档账本，不是对照上下文。
