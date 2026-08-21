# Agent Note：`/search` —— 转向代理而不是跑 ripgrep

Status: implemented

[English](2026-08-21-search-command-steers-the-agent.md) | 中文

## 问题

`/search` 的第一版实现（见已归档的 [`/search` ripgrep 命令](../../archived/feature/2026-08-20-search-command-ripgrep-over-workspace-references.md)）是宿主直接跑 ripgrep，把匹配行原样倒出来：200 行 `文件:行号: 文本`。回答"这个概念在哪里"需要判断力，而 grep 输出给不了——用户要的是"具体文件列表"，每个文件附一行匹配理由，不是一堆匹配行的原始转储。

## 决策

命令不再执行任何东西。它把用户的查询合成一条搜索指令（steer），以插件来源 `command-search` 的用户消息发给接收代理，命令结果只确认"搜索已入队"（`Search queued for this session.`）。搜索本身是代理自己的一个回合：它用自己的文件工具（内容用 `grep`、路径用 `glob`、确认用 `read`）去查，然后回答一份去重、按相关性排序的文件列表，每个路径附一行理由；查无结果时单独一行说明。指令、工具调用与列表全部落在会话日志里——模型可见即已记录，无需新事件。空闲代理立即开始该回合；运行中的代理在下一个步骤边界消费这条指令。

## 备选方案

- **保留 ripgrep，改进输出格式。** 否决：原始匹配行再怎么排版也无法排序和解释——排序需要模型对查询意图的理解，宿主没有这个视角。
- **专用宿主工具返回排名后的文件。** 否决：排名本质上是模型判断；把搜索回合重新包成工具会复制代理循环的机制。
- **steer 之外不返回任何命令结果。** 否决：命令必须安顿用户的预期；"已入队"告诉用户文件列表将作为回复到达。

## 影响

- 取代并归档 [2026-08-20 的 ripgrep 版 `/search` 笔记](../../archived/feature/2026-08-20-search-command-ripgrep-over-workspace-references.md)：200 匹配、16KiB 折叠、30 秒时限与 256KB 原始 stdout 上限这些 ripgrep 协议常数不复存在；搜索工作的边界改由搜索回合自身的限制承担。
- 范围收窄到会话项目目录：被转向代理的文件工具在默认沙箱模式下只授予项目目录，reference 项目不在其内——ripgrep 实现能覆盖 references，steer 不能。
- 命令现在一次调用一条指令、没有标志；更窄或更宽的搜索是不同的查询。
- Web 与 CLI 从同一条宿主命令继承相同行为；不涉及客户端表面。
