# Agent Note: 无工作区会话的参考项目

Status: implemented

[English](2026-09-08-session-references-workspace-less-sessions.md) | 中文

## Problem

挂载参考项目曾被限制在属于某个工作区的会话中：两个网关入口（带 `referenceWorkspaceIds` 的 `session.create`、`session.setReferences`）都以 `references-require-workspace` 拒绝无工作区会话的非空集合，会话头部的参考 chip 对同样的会话也隐藏自己。Connector（provider）会话恰好就是无工作区会话，因此用户想让 Confluence 聊天同时读取本地文件夹时没有路径：chip 不存在，直接调用被拒绝。本变更的第一版对任何会话都放行参考；随后落地的会话类型界面矩阵把规则收窄：普通 chat 同样没有可参考的项目，因此被排除在外。

## Decision

参考项目对两类会话有效：

- 被某个已注册工作区拥有的会话（工作区自己的 chat）可以引用其他已注册工作区。
- 运行 provider preset 的会话——preset id 被已组合 connectors 服务声明（`presetIds()`）——可以引用任意已注册工作区，因为 connector 的固定模式就是该会话的项目面。
- 其余所有会话（普通 chat）在两个网关入口都收到 `references-unavailable` 拒绝；服务层校验（目录存在、不得是会话自身 cwd、`maxReferences` 上限）仍是被放行形态的唯一强制点，空的全量值仍保持为幂等的解除全部 no-op。
- 客户端 chip 的隐藏规则镜像 host：仅当 `workspaceReferences` 投影已组合且会话被工作区拥有或为 provider 时才显示；其菜单列出除会话自身外的所有已注册工作区（非拥有会话没有自身行可排除）。
- 被取代的 `references-require-workspace` 代码离开 RPC 错误映射、线协议 schema 与生成的 cordis API 目录；`references-unavailable` 取而代之。

## Alternatives considered

**任何会话都放行参考（中间规则）。** 唯一事实来源（能力的组合）且无数据跨界；它在本 pre-release 窗口内、表面矩阵落地之前曾作为本版实现。它给了普通 chat 一个它没有名字可言的项目面——它的模式不固定于任何东西，所以那里的参考集合没有归属。

**在 connector 详情面上单独的添加文件夹控件。** 它会为第二个表面复制 chip、全量动词与菜单；connector 聊天是普通会话，其头部已有 chip 的槽位。

## Testing

- `dsh-apiproxy`：带参考且无工作区的 create 仅在会话运行 provider preset 时放行并记录一条全量 `workspace/references` 事件；普通 chat 以 `references-unavailable` 被拒且不提交 agent。`setReferences` 镜像两个方向。未挂载部署与自身 cwd 的拒绝不变。
- `dsh-connectors`：声明的 preset id 在 catalog 与自定义 connector 上发布（`presetIds()`）。
- 客户端 chip 规格：普通 chat 不渲染；未被声明的 preset 不渲染；provider 会话渲染触发器并列出所有已注册工作区；工作区拥有的会话不变。
- `pnpm run test:gui` 绿；`DSH_SNAPSHOT=replay pnpm run test:web` 确认组装的 e2e 场景。

## Consequences

- 在能力已组合时，参考 chip 出现在工作区会话头部与 connector 聊天头部；普通 chat 隐藏它，其上键入或脚本化的参考调用收到 `references-unavailable`。
- Hero 选择器的多选不变：第一个勾选的项目为主项目，普通 chat 保持空勾选集。
- [会话参考项目](../architecture/2026-08-18-session-reference-projects.md) 继续拥有事件、上限与提示词段落；按会话类型的界面矩阵说明（本目录中 `2026-09-09-` 日期的文件）拥有本规则所属的固定表面。
