# Agent Note：`/help` 与 `/mode` —— 基于命令 UI 的客户端斜杠表面

Status: implemented

[English](2026-08-20-web-help-mode-client-surfaces.md) | 中文

## 问题

部署中最常用的两条斜杠命令在 Web 端都没有顺手的入口。`/help` 根本不存在：用户想知道"本会话能运行哪些斜杠命令"，只能打开 `/` 菜单、滚动、再关掉。而 `/mode`（宿主预设切换）在 Web 上是一条带参命令：裸选或裸回车只会得到用法提示，用户还得自己知道预设 id 并亲手输入。

## 决策

`@deepseek-ai/dsh-client-ui-slash-tools`（Web 斜杠工具特性归属方）增加两个客户端表面，都建在 `ctx.commandUi` 之上；`@deepseek-ai/dsh-client-ui-commands` 增加这项需求所需的唯一契约方法。

`CommandUiContract` 增加 `menuRows(session, signal)`：合并的斜杠菜单视图（宿主目录 + 可用的客户端贡献项，菜单顺序，含 chat 会话隐藏 `/permission` 的规则），不做位置或查询过滤。它与 `/` 菜单走同一套行合成逻辑，从 `candidates()` 中抽出，使菜单与该面永不漂移。

`/help` 是客户端贡献项（popupSelect）：选项就是 `menuRows` 以 `/名称` 行加行描述呈现。选中某行只关闭弹层、不执行任何命令——列表本身就是答案；从帮助弹层执行命令只会复制菜单自己的派发路径，且缺少其 span 处理。

`/mode` 是挂在宿主命令上的装饰（popupSelect）：裸选打开预设名册弹层，名册来自 `agentPreset.list` 线读，省略损坏预设（选择器规则：损坏预设无法重组会话），标记会话当前预设为 active，chat 会话不提供（宿主双向拒绝切换）。选中某行通过 commands Remote 提交完整的 `/mode <预设>` 行——刻意走宿主命令而非 `agentPreset.select` RPC（后者仅限空会话，是新建会话席位流程）。经由命令自己的准入路径提交，使宿主的空闲守卫、chat 守卫、重组与 `agent-preset/selected` 记录保持单点归属，也让浏览器的 `command/executed` 观察者只面对一条提交通道。

## 备选方案

- **`/mode` 走 `agentPreset.select` RPC。** wire 已经存在。否决：它拒绝已开始的会话（`agent-preset-locked`）——正是 `/mode` 服务的会话——且会绕过命令的生命周期日志与 `agent-preset/selected` 记录。
- **宿主侧的 `/help` 命令。** 宿主可以读本会话目录。否决：Web 菜单还要显示仅客户端的贡献项（`/clear`、`/help` 自身），而合并视图只存在于客户端命令服务——宿主命令要完整就需要第二份目录来源。
- **`/help` 选中即执行对应命令。** 否决：菜单选中已拥有完整的派发与 span/token 处理；从帮助弹层再建一条派发路径，对一个无需行为的说明性列表是重复机制。

## 影响

- `CommandUiContract` 不再是只读注册/装饰：业务包现在可以读取自己注册进去的合并菜单。该方法当前只有 `/help` 一个消费者；行形状保持最小（名称 + 描述），避免未来消费者把该面推宽。
- `/mode` 的名册读取每次开弹层调用一次 `agentPreset.list`——与设置区、新建会话席位使用同一套不缓存的发现。
- `/help` 与 `/clear` 的描述是注册时读一次后由注册表持有的文本；重新注册时刷新，语言切换不刷新（README 限制）。
- 两个新表面按构造为 Web 专属（客户端插件）；CLI 的 `/help` 将是另一条宿主命令，保持暂缓。
