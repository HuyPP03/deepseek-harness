# Agent Note: `/clear` — 用新会话动作清空本会话

Status: implemented

[English](2026-08-20-clear-command-fresh-session-action.md) | 中文

## Problem

用户想要"清空当前对话"时，Web 端没有任何文本入口：侧边栏的 New Session 走的是复用该 Workspace 空会话的英雄流程，`/model`、`/effort` 等命令又都不涉及会话本身。没有一条命令能回答"丢掉这段对话、在同一项目里重新开一个"。

## Decision

新增 client 插件 `ui-slash-tools`，向命令面注册 `/clear` 动作（action 类型）：

- **仅在会话有可清空内容时可用**——capability 过滤读会话列表快照，当前会话为空（或 id 未知）时隐藏该条；行为在运行时重查空态，菜单扫描与选中之间变空的会话成为 no-op。
- **行为就是一次创建加一次打开**——通过新外露的 `ISessions.create` 面铸造新会话（`workspaces.startNewSession` 内部已用的 `SessionRuntime.create`），按会话记账的 Workspace 归属加入当前会话的 Workspace（与 New Session 复用扫描同一规则；chat 会话无归属），`agentPreset` 存在时随行携带，然后 `open` 新 id 使导航落在那里。原会话保留在列表中不受影响。
- **失败仅记录日志**：action 类型没有结果通道——创建被拒时 run promise 拒绝，由命令服务记录日志。对"可以从菜单重试的便利快捷键"而言这是合适语义，也让插件免于错误 store 与重试 UI。

在 `ISessions` 上暴露 `create` 是契约头部所描述的显式扩宽：该方法此前只存在于具体运行时内部（workspaces 流程使用），动作类型是第一个需要它的外部消费者。test-runtime 的 `TestSessions` double 获得一个匹配的、带记录行为的 stub：物化一个未选中的空 fixture 行，使 `open` 可以寻址它。

## 曾考虑的替代方案

- **用 `workspaces.startNewSession` 代替 `sessions.create`。** 否决。英雄 New Session 流程会复用该 Workspace 的空会话（落进既有空会话的 `/clear` 是用户看不见的 no-op），且不携带 `agentPreset`——新会话会静默运行部署默认组成，而不是它所替换的组成。
- **做成 host 命令（如 `/effort`）。** 否决，属过度设计：这里不需要任何 Host 状态——会话、其 Workspace 归属、其预设全在 client 自己的列表快照里，写操作是 client 已拥有的 `session.create` RPC。host 命令在 Web-only 表面上也买不到任何能力。
- **携带当前会话的引用工作区。** 暂缓。列表摘要不携带引用轴，动作的数据源看不到它们；带引用创建需要新的摘要字段或一次 RPC 往返，而菜单并不为此做广告。

## Consequences

- `/clear` 为 Web-only（client 插件），出现在斜杠菜单与裸回车；手输的 `/clear <参数>` 行不被认领（action 类型不接受参数），也不会产生任何效果。
- 被清空会话的引用工作区不会带过去（见包 README 的 Known Limitation）；工作区与预设都会带。
- 新会话按定义是空会话，create 不会自动选中它；由动作的 `open` 移动舞台。
