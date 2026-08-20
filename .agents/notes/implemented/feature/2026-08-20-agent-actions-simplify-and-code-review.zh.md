# Agent Note: `/simplify` 与 `/code-review` —— 对会话改动代码的简化与并行评审

Status: implemented

[English](2026-08-20-agent-actions-simplify-and-code-review.md) | 中文

## 问题

在会话中工作的人类没有一条快捷路径来“把这次会话改过的代码理顺”或“让别的 agent 评审一遍”：模型侧的简化与评审只能靠 prompt 请求，花掉一个轮次、一次请求和一次等待；而会话日志本身已经完整记录了哪些文件被 `edit`/`write` 改过，却没有任何一行命令把它暴露出来。

## 决定

新 host 包 `@deepseek-ai/dsh-command-agent-actions` 向 `ctx.commands` 贡献两个无参数命令，挂载在 `standard` 与 `code` 两个 agent 预设（`chat` 预设没有可评审或可简化的代码改动，所以不挂载它）。两者都通过仅记录的 `command/run` / `command/done` 事件对结算。

`/simplify` 向接收 agent 发送一条组合出的、保持行为不变的简化指令（source 为 `plugin: command-agent-actions`）。空闲 agent 开启新轮次；运行中的 agent 在下一个 step 边界消费该 steering，因此该命令按构造就是 busy-safe 的。

`/code-review` 只从会话日志推导评审范围——所有 `edit`/`write` 工具调用的去重 `file_path`，按首次触碰顺序排列——并在 `provider` 配置字段指定的 subagent provider（默认 `spawn`，由 host bundle 注册）上并行启动四个 one-shot 评审子 agent（correctness、security、performance、maintainability）。每个子 agent 的提示词自包含——改动文件列表（上限 100 条路径）加上它唯一的 facet 与只报告指令——因为 one-shot 子 agent 不能假定继承父级上下文。发现折叠成一份报告：按固定顺序每个 facet 一个小节、启动失败者列入 `## failed facets` 小节、未完成者标记 `(reviewer did not finish: <stop reason>)`，并守住 32 KiB UTF-8 字节预算（带截断标记），让超大的评审不能撑大会话日志。配置的 provider 未注册时，命令退化为一条发到接收 agent 的 steering 消息并在结果中说明；所有 facet 都启动失败时，handler 拒绝、执行器把事件对结算为该错误。取消与其他命令一样由命令执行器负责；已发布的 run 始终被 dispose。

该报告只报告：任何结果文本都不指示修改，且折叠报告永不进入模型请求——它是人类的结果卡片。

## 备选方案

- **单一 reviewer 子 agent（或主 agent）评审全部四个关切。** 更小，且免费继承会话上下文。否决：四个关切的单一评审是一长次等待加一个不聚焦的回答；四 facet 拆分才是人类真正想要的形状，且 provider 的 one-shot 子 agent 本就并行运行。
- **把会话 diff 传进每个子 agent 的提示词。** 否决：日志记录的是 `edit`/`write` 调用的最终内容，不是统一 diff，所谓“diff”还得靠读文件重新推导；文件列表加读文件访问已经给子 agent 同样的信息，不需要重复解析日志。
- **用 `toolFilter` 禁掉 reviewer 子 agent 的写工具。** 暂时否决：只报告指令是当前契约，且并非每个已注册 provider 都实现了 `toolFilter` 能力；强制执行推迟到有部署需要时再做（README 限制）。
- **把两个命令也挂到 `chat` 预设。** 否决：chat 会话没有记录在案的代码改动，两个命令只会永远回答“没有可做的事”。

## 后果

- 两个命令都是 host 命令：凡是挂载它们的预设的每个命令适配器（CLI 与 Web 都一样）都会出现它们。
- 主 `/code-review` 路径唯一的模型可见输出是四个子 agent 各自的提示词与轮次，在 provider 一侧；接收 agent 的请求零 token（只有 fallback 路径花一条 steering）。
- 评审范围按构造仅限 edit/write：通过 `bash` 改的文件对它不可见（README 限制），且范围以日志为准——评审覆盖会话日志记录的内容，而不是工作树。
- 四 facet 提示词与 100 路径 / 32 KiB 界限是协议常量，不是部署配置；唯一随部署变化的选择是 provider 名。
- active-set / drain / register 生命周期与 `command-compact`、`command-search` 镜像（jscpd 标记）；三个包共享一个命令生命周期 helper 是显然的后续简化。
