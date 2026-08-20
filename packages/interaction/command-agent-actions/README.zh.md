# @deepseek-ai/dsh-command-agent-actions

[English](README.md) | 中文

面向用户的 `/simplify` 与 `/code-review`，作用于会话已经修改过的代码。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册两个命令，并使用 agent 的 steering 通道与 [`ctx.subagents`](../../subagent/subagent/README.md) 服务：`/simplify` 向接收 agent 发送一条保持行为不变的简化指令，`/code-review` 则在配置的 provider 上并行启动四个 one-shot 评审子 agent（正确性、安全性、性能、可维护性），并把它们的发现折叠成一份只报告的评审结果。评审范围完全由会话日志推导：按首次触碰顺序排列的每个 `edit`/`write` 工具调用的 `file_path`。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/simplify` | 向 agent 发送一条保持行为不变的简化指令。空闲 agent 开启新轮次；运行中的 agent 在下一个 step 边界消费该 steering。`Simplification queued for this session.` |
| `/simplify <参数>` | `Usage: /simplify (no arguments)` |
| `/code-review` | 在配置的 provider 上并行启动四个 one-shot 评审子 agent，每个 facet 一个。它们的发现折叠为一份报告；任何结果文本都不指示修改。 |
| `/code-review`（无记录的编辑） | `No code changes were found in this session to review.`——是成功，不是错误。 |
| `/code-review`（provider 缺失） | 配置的 provider 未注册，评审改为一条 steering 消息排队到接收 agent 上执行；结果会说明这一点。 |
| `/code-review <参数>` | `Usage: /code-review (no arguments)` |

每条评审提示词列出改动文件（上限 100 条路径）与它唯一的 facet，并要求给出文件与行号引用、不做任何修改。报告按固定顺序保留每个 facet 一个小节，注明子 agent 未完成的 facet，在某个启动失败时追加 `## failed facets` 小节，并在超过 32 KiB 字节预算时截断并加标记。取消由命令执行器负责：被中止的请求把 `command/done` 事件对结算为该中止，已发布的 run 在 handler 结算时被 dispose。

## 组合

该插件注入 `commands` 与 `subagents`。挂载命令注册表、subagent 服务（其 provider 来自 host bundle）与本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: subagents
  name: '@deepseek-ai/dsh-subagent'
- id: command-agent-actions
  name: '@deepseek-ai/dsh-command-agent-actions'
```

`/code-review` 在 `provider` 配置字段指定的 provider（默认 `spawn`）上启动子 agent；注册了其他评审传输的部署在该行设置此字段。随产品发布的 `dsh` 预设把它挂载在 `standard` 与 `code` 两个 agent 预设上；`chat` 预设不挂载，因为 chat 会话没有可评审或可简化的代码改动。插件卸载先注销两个命令，再排空所有已开始的 handler，保证根卸载不会活在一个仍在运行的评审之后。

## Model Experience

### 人类 steering 进入循环

#### 模型看到什么

`/simplify` 与 `/code-review` 的 fallback 各向接收 agent 发送一条 steering 消息：模型在下一轮次中遇到该组合指令（source 为 `plugin: command-agent-actions`）。四个并行评审子 agent 各自看到自己的单 facet 提示词与改动文件列表。折叠后的报告文本永不进入任何模型请求——它是人类的结果卡片，通过仅记录的 `command/run` / `command/done` 事件对结算。

#### Token 影响

一次 `/simplify` steering 向下一轮次的上下文加入一条指令消息（及其追加的日志）。一次 `/code-review` 运行在 provider 一侧加入四个短小的子 agent 上下文（每个 facet 提示词加子 agent 自己的工作），并向接收 agent 的请求加入零 token；只有 fallback 路径才在那里花一条 steering 消息。

#### KV Cache 影响

steering 消息在接收 agent 上一个 step 边界之后延长其前缀，因此前缀缓存复用在到达该边界前保持不变。四个并行子 agent 拥有自己的前缀，不触碰父级缓存。

## Known Limitations and Deferred Work

- **范围仅限 edit/write**——评审范围是 `edit`/`write` 工具调用的 `file_path`；通过 `bash`（或完全没有工具调用）改文件的会话报告没有可评审内容。
- **评审约束仅在提示词层面**——子 agent 以其部署的正常工具运行；“只报告”是每条 facet 提示词中的指令，而不是工具过滤器。通过 `toolFilter` 能力强制执行的工作推迟到有部署需要时再做。
- **无 diff 上下文**——子 agent 收到改动文件列表并自行读取文件；不引用改动前状态，因此对被重写的文件的评审基于当前内容推理。
- **固定的报告预算**——32 KiB 折叠报告上限与 100 路径提示词上限是协议常量，不是部署配置。
