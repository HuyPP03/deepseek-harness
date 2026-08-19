# Agent Note：Web 文件引用（files.list 之上的 @ source）

Status: implemented

[English](2026-08-19-web-file-mentions.md) | 中文

## Problem（问题）

用户在 composer 中引用文件时没有任何选取途径：`@` 触发符上只有 subagent source，而手敲路径既容易出错，在文件位于会话 cwd 之外的已附着 reference 项目时更无法解析。模型需要一个可以交给其 file 工具的路径，且路径形式必须按 root 区分——主项目用 workspace 相对路径，reference 用绝对路径。

## Decision（决策）

新增 `files` RPC 域（按会话寻址，`files.list`），以及新的客户端插件 `ui-file-mention`，在既有 input-trigger 管线上注册 `@` `files` source。

- **宿主侧**——`packages/host/apiproxy`：`files.list({ sessionId })` 在宿主侧解析会话工作集——`session.header.cwd` 加上 `referencesOf(session)`（从会话日志折叠出的 reference 集合）——并按 wire 契约的固定边界遍历：深度 8、跨 root 至多 1000 个文件、仅文件、跳过点前缀条目与 `node_modules`、绝不跟随符号链接（防环；悬空链接不命名任何工作集文件）。边界是契约的协议常量，不是部署可调参数。遍历只读元数据（不读内容），运行于宿主进程、在 agent 沙箱之外。消失或不可读的 root 记为空而非令列表失败；`truncated` 报告条目边界。
- **Wire**——`FileEntry { path, relative, root }`，`root` = `'workspace'` 或 reference 的 basename；与 `skill.list` 一样按会话寻址（客户端从不提交路径；不创建或恢复任何 Agent）。
- **客户端**——`packages/client/ui-file-mention`（仅 browser half）：一个 source，`trigger: '@', name: 'files'`。候选在客户端对 settled 列表过滤（大小写不敏感：basename 前缀 < 路径前缀 < 子串；菜单至多 50 行）。菜单显示简短的展示形式——workspace 为 `rel/path`，reference 为 `rootname/rel/path`；`onPick` 通过每会话的 settled 缓存映射回**插入形式**，落入纯文本 `@<path> `：主项目用 workspace 相对路径（模型以自身 cwd 寻址 workspace），reference 用规范绝对路径（位于模型 cwd 之外；所有 confined mode 下读操作不受限）。缓存被清空后退化为展示形式。
- **缓存**——每会话一个单飞拉取，TTL 15 秒：文件树没有变更推送，短 TTL 用于限制陈旧度。scope 出生时 warm 预热 key；失败拉取不污染 key；`connection/reset` 清空全部。subagent scope 不列任何内容。
- **菜单标题**——管线既有 `slash.menu` locale namespace 中的 `files` key（`Files` / `文件`）；组标题按 source 名开放式查表。

## Consequences（后果）

- 选中的引用以字面量 `@<path>` 文本进入普通 user message 供模型读取——plain-text-reference 决策（[Web 输入机器与 slash 管线](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)）：无专用块、无宿主侧解析、无新 session event、无 prompt section、不推动 `SESSION_FORMAT_VERSION`；message 即 log，因此"模型可见 ⟺ 已记录"在既有表面上成立。
- `files.list` 遍历在宿主侧且只读元数据：它向浏览器暴露目录名（从不暴露内容），点前缀跳过规则把秘密文件（`.env` 一类）挡在引用选择器之外。
- Web GUI 获得第三个触发 source 组；fixture API client 提供静态三行工作集供离线验收。
- 已知限制：无 chip 装饰（输入机器的 text-reference 扫描器只匹配类词名——不含点号或斜杠——路径永不点亮；扩展扫描器属于输入机器变更）、最长 15 秒的列表陈旧度、遍历静默截断（无菜单错误层）、仅文件（无目录、无内容搜索）。

## Alternatives considered（已考虑的方案）

- **复用 `host.listDirectory`**：它是在 `browse` 能力下由客户端提交原始路径的逐层浏览器列表——与按会话寻址的引用 source 的取向相反，且深度 8 的树需要许多次顺序往返。
- **带 codec 的 `ReferenceInsert` chip**：chip 能给出带样式的出现位置，但纯文本路径是 skill source 的先例，无需 codec，且作为普通 message 文本可在重放中存活。
- **通过 source lexicon 做 chip 装饰**：text-reference 扫描器的名称模式（`[\\w-]+`）无法匹配文件路径，lexicon roll 永不点亮；现在实现它只是死重（已知限制记录了后续跟进）。
