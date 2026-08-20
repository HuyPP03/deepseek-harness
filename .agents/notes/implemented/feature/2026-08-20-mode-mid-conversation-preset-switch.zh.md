# Agent Note: `/mode` —— 对话中途切换会话的 preset

Status: implemented

[English](2026-08-20-mode-mid-conversation-preset-switch.md) | 中文

## 问题

一个会话被锁定在它创建时所用的 preset 上。`agentPresets.select` RPC 是唯一的切换入口，且仅限空白会话：会话一旦产出任何内容，网关就回答 `agent-preset-locked`，因为这个 RPC 呈现的是 composer 座位，而座位唯一还能改变的状态就是空白会话。对话进行中的用户没有任何办法在 roster 的各 preset 之间移动——从通用 preset 进入编码 preset，或再退回来——除非新开一个会话、丢掉现有对话。

## 决定

`AgentPresets` 服务在命令注册表存在时于其上注册宿主命令 `mode`：

- `/mode` 报告会话当前的 preset 与完整 roster。
- `/mode <preset>` 通过既有的 `recompose()` 把会话重链到该 preset 的常驻组装，然后追加与空白座位流程相同的 `agent-preset/selected` 事件，使 resume 或 fork 能重建切换后的组装。

命令携带两道闸门，`recompose()` 本身保持由调用方把关：

- **空闲。** 运行中的轮次在其步骤期间独占其组装。handler 在 `agent.status` 为 `running` 时拒绝，且切换在每会话锁之下重读该状态，因为轮次可能在请求与重链之间启动。同一会话的并发切换经该锁串行化，后到者生效。
- **chat preset。** 新增 `chatPresetIds` 配置字段，指明会话创建于其上、`/mode` 双向都不可跨越的 preset。chat 会话是固定的对话界面，不是一个模式；web 部署像固定只读 permission preset 那样固定 `chat`。

对话中途的历史是惰性的：新目录无法执行的已记录 tool call 留在日志里，与对话中途换模型留下的完全同构。命令自身不记录输入——`agent-preset/selected` 事件拥有载荷（`recordInput: false`）。

`agentPresets.select` RPC 不变：仍是仅空白，仍是座位流程的闸门。

## 考虑过的替代方案

- **把 RPC 放宽到已开始的会话。** 否决。RPC 的契约是座位的：一个用户尚未开始的空白会话。一个带有不同闸门的、对话中途的第二写入路径是命令，而命令本已拥有对活会话的用户发起操作。
- **一个映射到 preset 的独立「模式」概念。** 否决。模式就是 preset——roster、组装与切换机制都相同；平行的词汇会把同一个东西命名两次，并让两者漂移。
- **完全禁止切换（现状）。** 作为面向用户的回答被否决；那道拒绝是空白座位的线路契约产物，不是「已开始会话必须不可变」的声明。

## 后果

- 已开始会话的组装可以在其下改变，因此所有重建路径本来就解析运行中的 preset（`resolveSessionPreset`）而非读头部；那里不需要任何新东西。
- model-visible ⟺ logged 规则成立，因为切换在重链之后提交 `agent-preset/selected` 事件，且命令不追加其他载荷。
- `chatPresetIds` 是部署形状的：闸门只与配置同等强。未配置它的表面（CLI）自由切换 chat 会话；web 表面固定 `chat`。
- 客户端菜单项（裸 `/mode` 的 roster 弹出）随 slash 工具 UI 工作落地，不在这个命令里。
