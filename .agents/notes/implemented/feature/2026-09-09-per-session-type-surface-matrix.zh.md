# Agent Note: 按会话类型的界面矩阵

Status: implemented

[English](2026-09-09-per-session-type-surface-matrix.md) | 中文

## Problem

Slash 菜单行、参考项目 chip、模式座位（mode seat）与权限 preset 各自按会话类型做了临时性的门控：chat 会话隐藏 `/permission` 并拒绝切换；provider（connector）聊天隐藏 `providerHidden` 行，但仍显示 `/mode`，且可以切入/切出其固定的 provider preset；在矩阵落地之前的参考资格改造后，参考 chip 对每个会话都显示。各部分对"哪些表面对会话是固定的"说法不一：connector 聊天提供了一个其自身模式并不属于的切换入口，而普通 chat 与 provider chat 在菜单上没有任何可见区别。

## Decision

一张矩阵，每个表面一个权威。会话类型：**chat**（`chatPresetIds` 中的 preset）、**workspace**（被某个已注册工作区拥有）、**provider/connector**（其 agent preset 被已组合的 connectors 服务声明；host 门控经 `ctx.get('connectors').presetIds()` 读取，菜单门控经 `connectorPresetIds` 客户端 provide 读取）。provider 会话既不是 chat 也不是 workspace；检查按该顺序进行。

| 表面 | Chat | Workspace | Provider |
| --- | --- | --- | --- |
| 参考 chip + `setReferences` | 隐藏，`references-unavailable` | 显示 | 显示 |
| `/mode` 菜单行 | 隐藏 | 显示 | 隐藏 |
| `/mode` host 守卫 | 跨 `chatPresetIds` 拒绝 | — | 切入/切出任何被声明的 provider preset 均拒绝；无参 roster 不列出 chat 与 provider preset |
| `/permission` 菜单行 | 隐藏 | 显示 | 隐藏 |
| 权限 preset | 创建时固定为只读，拒绝切换 | 用户可切换 | 创建时固定为只读，拒绝切换 |
| 模式座位（hero） | 提供 | 提供 | 过滤掉 |

- `agent-presets` 的 `switchModeCommand` 增加了 provider 守卫（与 chat 守卫同形：current 或 target 落在被声明集合中即拒绝），无参 roster 现只列出可切换的 preset。
- `permission-presets` 将新建的 provider 会话固定到配置的 chat preset（默认只读），并在其运行被声明 preset 期间拒绝 `/permission` 切换。
- `ui-commands` 对 chat 与 provider 会话隐藏 `/mode` 行，对两者隐藏 `/permission` 行。
- host 参考门控与 chip 资格规则属于参考资格说明（本目录中 `2026-09-08-` 日期的文件）；hero 座位在本矩阵之前就已过滤 provider preset。

## Alternatives considered

**为每行加专门的 `providerHidden` 标志（仿照现有标志）。** 每新增一个固定表面就多一个标志，且标志可能与 host 守卫互相矛盾；矩阵把判断集中在会话类型上，现有 `providerHidden` 标志继续用于 provider 聊天真正缺失的行（代码工作区工具），而非其仅被固定的行。

**把 provider preset 直接从 roster 中组合出去。** 其会话仍报告当前 preset，且 roster 是组合事实而非菜单事实；拒绝切换才是实施"固定"的正确位置。

## Testing

- `dsh-agent-presets` mode 规格：切入与切出 provider preset 均被拒；无参 roster 不列出 chat 与 provider preset。
- `dsh-permission-presets` 规格：新建 provider 会话固定为只读；未被 connector 声明的 preset 保留用户默认；`/permission` 切换在被声明 preset 上被拒。
- `ui-commands` 服务规格：`/mode` 与 `/permission` 行在两个固定表面都隐藏，在普通会话保留。
- `pnpm run test:gui` 绿；`DSH_SNAPSHOT=replay pnpm run test:web` 确认组装的 e2e 场景。

## Consequences

- connector 聊天呈现为完全固定——模式、权限与其 provider 工具——同时仍携带参考 chip，因此其"固定"从不读作缺失的能力。
- 矩阵没有新增线协议字段：会话类型由线上已有事实解析（header 的 `agentPreset`、connectors roster），因此 ACP 与 SDK 投影均无变化。
- 未来的固定表面只需加一列矩阵项、一个 host 守卫、一条菜单行规则；三处即同一行表格。
