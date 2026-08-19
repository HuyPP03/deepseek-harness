# @deepseek-ai/dsh-client-ui-file-mention

[English](README.md) | 中文

Web 文件引用（file mention）source 插件：向 `ctx.inputTriggers` 注册 `@` file source。候选来自按会话寻址的 `files.list` RPC——宿主解析会话的项目 cwd 与其已附着的 reference 项目，客户端从不提交路径。选中某一行会在 draft 中落入纯文本 `@<path> `（plain-text-reference 决策：prompt 发送同一字面量，user message 即 session log）。菜单显示简短的展示形式——workspace 为 `rel/path`，reference 为 `rootname/rel/path`；pick 通过每会话的 settled 缓存映射回插入形式，缓存被清空后退化为展示形式。

插入形式按 root 区分：主项目文件插入 workspace 相对路径（模型以自身 cwd 寻址 workspace），reference 文件插入规范绝对路径（它位于模型 cwd 之外，而所有 confined mode 下读操作不受限）。拉取按会话缓存为单飞 promise，TTL 15 秒——文件树没有变更推送，短 TTL 用于限制陈旧度——scope 出生时 warm 预热该会话 key，失败拉取不污染 key，`connection/reset` 清空全部。subagent scope 不列任何内容。

## Model Experience（模型体验）

### user message 中的 `@<path>` 引用

#### 模型看到什么

选中的引用以字面量 `@<path>` 文本进入普通 user message——没有专用块、没有宿主侧解析、没有 prompt section。模型将其读作文件路径引用，并用其 file 工具处理。

#### Token 影响

条件性且仅追加：引用只向其所在的新的 user message 增加路径 token。菜单浏览与过滤不增加任何模型 token。

#### KV Cache 影响

仅追加。本包从不修改先前请求的 token。

## Known Limitations and Deferred Work（已知限制与延期工作）

- **draft 中无 chip 装饰**——输入机器的 text-reference 扫描器只匹配类词名（不含点号或斜杠），文件路径不会点亮为 plain-text reference；扩展扫描器属于输入机器变更。
- **列表陈旧度最长 15 秒 TTL**——没有 fs-watch 推送；创建、重命名或删除的文件在 TTL 后进入下一次拉取。
- **有界遍历，静默截断**——`files.list` 最深遍历 8 层、跨 root 至多 1000 个文件，跳过点前缀条目、`node_modules` 与符号链接，以 `truncated` 报告而无菜单错误层；菜单至多 50 行。
- **仅文件**——目录不可引用；查询为大小写不敏感的子串过滤（无内容搜索，排序无超过前缀层的 fuzzy 能力）。
